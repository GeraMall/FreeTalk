"""Render the local promotional edit from recordings of real React components.
Requires Pillow and numpy; ffmpeg path may be supplied with --ffmpeg.
No downloaded footage, music, personal accounts or production APIs are used.
"""
from pathlib import Path
import argparse, subprocess, wave
import numpy as np
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / 'output/marketing'
ASSETS = ROOT / 'design/landing/assets/demo'
FONT = Path('C:/Windows/Fonts')
FF = next((ROOT / 'output/media-tools/imageio_ffmpeg/binaries').glob('ffmpeg*.exe'), 'ffmpeg')
parser=argparse.ArgumentParser();parser.add_argument('--ffmpeg',default=str(FF));args=parser.parse_args()
OUT.mkdir(parents=True,exist_ok=True);ASSETS.mkdir(parents=True,exist_ok=True)

def font(size,bold=False):return ImageFont.truetype(str(FONT/('segoeuib.ttf' if bold else 'segoeui.ttf')),size)
def run(*cmd):
    result=subprocess.run([args.ffmpeg,'-y','-hide_banner','-loglevel','error',*map(str,cmd)],capture_output=True,text=True)
    if result.returncode:raise RuntimeError(result.stderr)
def base():
    y,x=np.mgrid[0:1080,0:1920]; glow=np.exp(-((x-1600)**2+(y-100)**2)/(950**2)); glow2=np.exp(-((x-100)**2+(y-900)**2)/(800**2))
    rgb=np.stack([5+11*glow+3*glow2,11+15*glow+9*glow2,21+30*glow+15*glow2],axis=2).astype('uint8')
    im=Image.fromarray(rgb).convert('RGBA');d=ImageDraw.Draw(im)
    d.arc((1210,-480,2300,610),0,360,fill='#28364e',width=1)
    d.arc((1120,-570,2390,700),0,360,fill='#1a2940',width=1)
    logo=Image.open(ROOT/'design/landing/assets/trlka-logo.png').convert('RGBA').resize((64,64),Image.Resampling.LANCZOS)
    im.alpha_composite(logo,(70,58));d.text((152,62),'TRLKA',font=font(38,True),fill='#f0f4ff')
    d.text((72,1018),'Демонстрационный стенд · вымышленные участники',font=font(20),fill='#8494ae')
    return im

scenes=[('friends','01 / СВОИ ЛЮДИ',['Ближе,','чем кажется.'],['Друзья — рядом.','Разговор — в один клик.']),('chat','02 / ПЕРЕПИСКА',['Начинается','с «привет».'],['Планы, сообщения','и маленькие реакции.']),('call','03 / РАЗГОВОР',['Все здесь.','Можно просто','поговорить.'],['Своя комната.','Знакомые голоса.']),('screen','04 / ОБЩИЙ ЭКРАН',['Покажи.','Обсудите.','Сделайте.'],['Делитесь экраном','прямо во время звонка.'])]
for name,kicker,title,body in scenes:
    im=base();d=ImageDraw.Draw(im)
    d.text((72,260),kicker,font=font(23,True),fill='#a5bae8')
    for i,line in enumerate(title):d.text((68,320+i*84),line,font=font(65,True),fill='#f2f5fc')
    for i,line in enumerate(body):d.text((72,660+i*40),line,font=font(29),fill='#aebcd1')
    d.rounded_rectangle((570,137,1870,959),radius=26,fill='#040a14',outline='#34455f',width=2)
    for i in range(4):d.rounded_rectangle((72+i*56,910,112+i*56,914),radius=2,fill='#9cb5e9' if i==[s[0] for s in scenes].index(name) else '#293549')
    im.convert('RGB').save(OUT/f'{name}-backdrop.png')
    mask=Image.new('L',(1280,800));ImageDraw.Draw(mask).rounded_rectangle((0,0,1279,799),radius=17,fill=255);mask.save(OUT/'mask.png')
    run('-sseof','-6.5','-i',OUT/f'{name}.webm','-loop','1','-i',OUT/f'{name}-backdrop.png','-loop','1','-i',OUT/'mask.png','-filter_complex','[0:v]fps=30,format=rgb24,setpts=PTS-STARTPTS[ui];[ui][2:v]alphamerge[rounded];[1:v][rounded]overlay=580:148:shortest=1,format=yuv420p[out]','-map','[out]','-t','6.5','-an','-c:v','libx264','-preset','fast','-crf','20',OUT/f'{name}-edit.mp4')
    print('Rendered',name,flush=True)

for name,lines,sub in [('intro',['Собраться. Поговорить.','Побыть вместе.'],'Место, где тебя слышно.'),('outro',['Свои люди.','Одно место.'],'trlka.com')]:
    im=base();d=ImageDraw.Draw(im)
    for i,line in enumerate(lines):d.text((140,330+i*125),line,font=font(100,True),fill='#f1f5ff' if i==0 else '#9fb8ef')
    d.text((148,670),sub,font=font(42),fill='#becde3');im.convert('RGB').save(OUT/f'{name}.png')
    run('-loop','1','-i',OUT/f'{name}.png','-vf','fps=30,format=yuv420p','-t','2.8','-an','-c:v','libx264','-preset','fast','-crf','20',OUT/f'{name}-edit.mp4')

parts=['intro','friends','chat','call','screen','outro'];lengths=[2.8,6.5,6.5,6.5,6.5,2.8];fade=.55
inputs=[]
for part in parts:inputs+=['-i',OUT/f'{part}-edit.mp4']
filters=[f'[{i}:v]fps=30,settb=AVTB,setpts=PTS-STARTPTS[v{i}]' for i in range(len(parts))];total=lengths[0];prev='v0'
for i in range(1,len(parts)):
    offset=total-fade;out=f'x{i}';filters.append(f'[{prev}][v{i}]xfade=transition=fade:duration={fade}:offset={offset:.2f}[{out}]');prev=out;total+=lengths[i]-fade
run(*inputs,'-filter_complex',';'.join(filters),'-map',f'[{prev}]','-an','-c:v','libx264','-preset','fast','-crf','20','-pix_fmt','yuv420p',OUT/'picture.mp4')

# Original, quiet instrumental bed: soft triads and a sparse plucked melody.
sr=48000;n=int(total*sr);audio=np.zeros((n,2),dtype=np.float64)
def note(start,duration,midi,volume,pan=0):
    begin=int(start*sr);end=min(n,begin+int(duration*sr));t=np.arange(end-begin)/sr;f=440*2**((midi-69)/12)
    env=(1-np.exp(-t*18))*np.exp(-t*2.2)*np.minimum(1,(duration-t)*8)
    sound=(np.sin(2*np.pi*f*t)+.18*np.sin(4*np.pi*f*t))*env*volume
    audio[begin:end,0]+=sound*(.7-pan*.25);audio[begin:end,1]+=sound*(.7+pan*.25)
chords=[[50,57,62,65],[46,53,58,62],[53,60,65,69],[48,55,60,64]]
for bar,start in enumerate(np.arange(0,total,2.4)):
    chord=chords[bar%4]
    for j,m in enumerate(chord):note(start+j*.07,2.9,m,.022,(j-1.5)/2)
    for j,m in enumerate([chord[2]+12,chord[3]+12,chord[1]+12]):
        if start+.6+j*.6<total:note(start+.6+j*.6,1.1,m,.026,(j-1)/2)
audio*=np.minimum(1,np.arange(n)/sr/1.1)[:,None]*np.minimum(1,(n-np.arange(n))/sr/1.5)[:,None]
with wave.open(str(OUT/'music.wav'),'wb') as w:w.setnchannels(2);w.setsampwidth(2);w.setframerate(sr);w.writeframes((np.clip(audio,-1,1)*32767).astype('<i2').tobytes())
run('-i',OUT/'picture.mp4','-i',OUT/'music.wav','-map','0:v','-map','1:a','-c:v','copy','-c:a','aac','-b:a','128k','-shortest','-movflags','+faststart',OUT/'TRLKA-demo-1080p.mp4')
run('-i',OUT/'TRLKA-demo-1080p.mp4','-vf','scale=1280:720','-c:v','libx264','-preset','slow','-crf','23','-c:a','aac','-b:a','96k','-movflags','+faststart',ASSETS/'trlka-tour.mp4')

# Honest crops of captured interface, without changing UI styling or text.
shots=ROOT/'output/playwright'
for name in ['friends','chat','call','screen']:
    Image.open(shots/f'marketing-{name}.png').save(ASSETS/f'{name}.webp','WEBP',quality=91,method=6)
crops={'call-detail':('call',(260,50,1265,300)),'chat-detail':('chat',(250,270,1270,745)),'friends-detail':('friends',(294,310,1216,535)),'screen-detail':('screen',(265,225,1255,785))}
for target,(source,box) in crops.items():Image.open(shots/f'marketing-{source}.png').crop(box).save(ASSETS/f'{target}.webp','WEBP',quality=92,method=6)
Image.open(shots/'marketing-invite.png').save(ASSETS/'invite.webp','WEBP',quality=92,method=6)
print(f'Complete: {total:.2f} seconds. Web MP4: {(ASSETS/"trlka-tour.mp4").stat().st_size/1024/1024:.2f} MiB',flush=True)
