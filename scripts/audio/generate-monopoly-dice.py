"""Original quiet wooden dice foley aligned with the 2.2 second shared throw."""
import math
import random
import struct
import wave
from pathlib import Path

rate = 24000
out = Path(__file__).resolve().parents[2] / 'apps/desktop/public/sounds/monopoly'
rng = random.Random(216)

def write(name, duration, impacts):
    samples = [0.0] * round(duration * rate)
    for start, gain, pitch in impacts:
        low = 0.0
        for i in range(round(.11 * rate)):
            at = round(start * rate) + i
            if at >= len(samples):
                break
            t = i / rate
            noise = rng.uniform(-1, 1)
            low += .22 * (noise - low)
            value = (math.sin(2 * math.pi * pitch * t) * .38 + low * .8 + noise * .12)
            samples[at] += value * math.exp(-t * 58) * gain * min(1, i / 18)
    with wave.open(str(out / (name + '.wav')), 'wb') as audio:
        audio.setparams((1, 2, rate, 0, 'NONE', 'not compressed'))
        audio.writeframes(b''.join(struct.pack('<h', round(max(-.7, min(.7, v)) * 32767)) for v in samples))

write('shake', .22, [(0, .36, 710), (.045, .3, 840), (.095, .27, 640)])
write('roll', 2.2, [(at, gain, pitch) for at, gain, pitch in [
    (0, .65, 390), (.07, .52, 580), (.16, .5, 430), (.29, .46, 640),
    (.44, .42, 410), (.62, .36, 570), (.83, .3, 480), (1.07, .25, 620),
    (1.33, .19, 430), (1.61, .12, 540), (1.91, .06, 610),
]])
