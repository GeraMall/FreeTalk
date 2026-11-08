"""Original quiet wooden dice foley aligned with the 2.2 second shared throw."""
import math
import random
import struct
import wave
from pathlib import Path

rate = 24000
out = Path(__file__).resolve().parents[2] / 'apps/desktop/public/sounds/monopoly'
rng = random.Random(217)

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
    (0, .22, 710), (.08, .2, 840), (.16, .18, 640), (.34, .45, 390),
    (.49, .36, 580), (.68, .3, 430), (.9, .25, 640), (1.15, .2, 410),
    (1.42, .14, 570), (1.7, .09, 480), (1.97, .04, 620),
]])
