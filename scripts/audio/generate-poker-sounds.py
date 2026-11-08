"""Generate original, deterministic, quiet poker foley. No external recordings."""
from pathlib import Path
import math
import random
import struct
import wave

RATE = 24000
OUT = Path(__file__).resolve().parents[2] / 'apps/desktop/public/sounds/poker'
OUT.mkdir(parents=True, exist_ok=True)
rng = random.Random(208)

def sound(name, seconds, events):
    samples = [0.0] * int(RATE * seconds)
    for start, duration, kind, gain in events:
        previous = low = 0.0
        for i in range(int(RATE * duration)):
            at = int(start * RATE) + i
            if at >= len(samples):
                break
            t = i / RATE
            noise = rng.uniform(-1, 1)
            low += .14 * (noise - low)
            if kind == 'card':
                v = (noise - previous) * math.sin(math.pi * t / duration) ** 1.4 * .2 + low * .1
            elif kind == 'knock':
                v = (math.sin(2 * math.pi * 145 * t) * .65 + low * .8) * math.exp(-t * 65)
            elif kind == 'chip':
                v = (math.sin(2 * math.pi * 1530 * t) * .25 + math.sin(2 * math.pi * 2840 * t) * .13 + noise * .1) * math.exp(-t * 48)
            else:
                freq = 660 if kind == 'note' else 880
                v = (math.sin(2 * math.pi * freq * t) + .17 * math.sin(2 * math.pi * freq * 2 * t)) * math.exp(-t * 14) * .12
            previous = noise
            samples[at] += v * gain * min(1, i / 40) * min(1, (duration - t) * 600)
    with wave.open(str(OUT / (name + '.wav')), 'wb') as f:
        f.setparams((1, 2, RATE, 0, 'NONE', 'not compressed'))
        f.writeframes(b''.join(struct.pack('<h', round(max(-.7, min(.7, v)) * 32767)) for v in samples))

sound('deal', .14, [(0, .11, 'card', .7)])
sound('shuffle', .8, [(i * .055, .13, 'card', .4 + (i % 3) * .08) for i in range(12)])
sound('flip', .22, [(0, .13, 'card', .7), (.11, .08, 'card', .35)])
sound('check', .25, [(0, .09, 'knock', .8), (.105, .09, 'knock', .55)])
sound('chips', .32, [(i * .04, .15, 'chip', .5 + (i % 2) * .2) for i in range(5)])
sound('fold', .2, [(0, .18, 'card', .55)])
sound('all-in', .55, [(0, .1, 'knock', .5)] + [(i * .045, .15, 'chip', .6) for i in range(9)])
sound('collect', .55, [(i * .06, .16, 'chip', .4) for i in range(6)])
sound('win', .65, [(0, .3, 'note', .65), (.18, .35, 'high', .7)])
sound('turn', .26, [(0, .24, 'note', .5)])
sound('warning', .4, [(0, .16, 'note', .4), (.2, .16, 'note', .4)])

sound('vote', .65, [(0, .22, 'note', .7), (.16, .24, 'high', .7), (.32, .28, 'note', .45)])
