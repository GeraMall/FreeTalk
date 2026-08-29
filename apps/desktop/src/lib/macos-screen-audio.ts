interface NativeAudioPlane {
  channels: number;
  data: string;
}

interface NativeAudioChunk {
  sampleRate: number;
  channels: number;
  planes: NativeAudioPlane[];
}

let active: NativeMacScreenAudio | undefined;

export async function startNativeMacScreenAudio(): Promise<MediaStreamTrack> {
  await stopNativeMacScreenAudio();
  const bridge = new NativeMacScreenAudio();
  try {
    const track = await bridge.start();
    active = bridge;
    return track;
  } catch (error) {
    await bridge.stop();
    throw error;
  }
}

export async function stopNativeMacScreenAudio() {
  const bridge = active;
  active = undefined;
  await bridge?.stop();
}

class NativeMacScreenAudio {
  private context?: AudioContext;
  private processor?: ScriptProcessorNode;
  private destination?: MediaStreamAudioDestinationNode;
  private unlisten?: () => void;
  private queues: number[][] = [[], []];

  async start() {
    const [{ invoke }, { listen }] = await Promise.all([
      import('@tauri-apps/api/core'),
      import('@tauri-apps/api/event'),
    ]);
    const AudioContextClass = window.AudioContext;
    if (!AudioContextClass) throw new Error('Web Audio недоступен');
    this.context = new AudioContextClass({ sampleRate: 48_000 });
    this.destination = this.context.createMediaStreamDestination();
    this.processor = this.context.createScriptProcessor(2048, 0, 2);
    this.processor.onaudioprocess = (event) => this.render(event.outputBuffer);
    this.processor.connect(this.destination);
    this.unlisten = await listen<NativeAudioChunk>('macos-screen-audio-chunk', (event) => {
      this.enqueue(event.payload);
    });
    await invoke('macos_screen_audio_start');
    await this.context.resume();
    const track = this.destination.stream.getAudioTracks()[0];
    if (!track) throw new Error('Не удалось создать аудиодорожку ScreenCaptureKit');
    track.contentHint = 'music';
    return track;
  }

  async stop() {
    this.unlisten?.();
    this.unlisten = undefined;
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      await invoke('macos_screen_audio_stop');
    } catch {
      // The bridge can be disposed while the app window is shutting down.
    }
    this.processor?.disconnect();
    this.processor = undefined;
    this.destination = undefined;
    this.queues = [[], []];
    await this.context?.close();
    this.context = undefined;
  }

  private enqueue(chunk: NativeAudioChunk) {
    const decoded = chunk.planes.map((plane) => ({
      channels: Math.max(1, plane.channels),
      samples: decodeFloat32(plane.data),
    }));
    if (decoded.length === 1) {
      const plane = decoded[0]!;
      if (plane.channels >= 2) {
        for (let index = 0; index + 1 < plane.samples.length; index += plane.channels) {
          this.queues[0]!.push(plane.samples[index] ?? 0);
          this.queues[1]!.push(plane.samples[index + 1] ?? plane.samples[index] ?? 0);
        }
      } else {
        for (const sample of plane.samples) {
          this.queues[0]!.push(sample);
          this.queues[1]!.push(sample);
        }
      }
    } else {
      this.queues[0]!.push(...decoded[0]!.samples);
      this.queues[1]!.push(...decoded[1]!.samples);
    }
    const maximumBufferedSamples = Math.max(chunk.sampleRate, 48_000) * 2;
    for (const queue of this.queues) {
      if (queue.length > maximumBufferedSamples) {
        queue.splice(0, queue.length - maximumBufferedSamples);
      }
    }
  }

  private render(output: AudioBuffer) {
    for (let channel = 0; channel < output.numberOfChannels; channel += 1) {
      const target = output.getChannelData(channel);
      const queue = this.queues[Math.min(channel, this.queues.length - 1)]!;
      const available = Math.min(target.length, queue.length);
      for (let index = 0; index < available; index += 1) target[index] = queue[index] ?? 0;
      if (available < target.length) target.fill(0, available);
      queue.splice(0, available);
    }
  }
}

function decodeFloat32(encoded: string) {
  const binary = atob(encoded);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return new Float32Array(bytes.buffer);
}
