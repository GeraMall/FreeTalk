"""Render the local promotional edit from recordings of real React components.
Requires Pillow and numpy; ffmpeg path may be supplied with --ffmpeg.
No downloaded footage, music, personal accounts or production APIs are used.
"""
from pathlib import Path
import argparse, subprocess
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
    return im

scenes=[('friends','01 / ДРУЗЬЯ',['Добавляйте','друзей'],['Поиск по имени.','Статусы и приглашения.']),('chat','02 / СООБЩЕНИЯ',['Пишите','в чатах'],['Личные и групповые чаты.','Сообщения и реакции.']),('call','03 / ЗВОНКИ',['До 8 человек','в звонке'],['Громкость для каждого.','Микрофон и камера.']),('screen','04 / ДЕМОНСТРАЦИЯ',['Показывайте','свой экран'],['Демонстрация экрана','во время звонка.'])]
for name,kicker,title,body in scenes:
    im=base();labels=Image.new('RGBA',(1920,1080));d=ImageDraw.Draw(labels)
    d.text((72,260),kicker,font=font(23,True),fill='#a5bae8')
    for i,line in enumerate(title):d.text((68,320+i*84),line,font=font(60,True),fill='#f2f5fc')
    for i,line in enumerate(body):d.text((72,660+i*40),line,font=font(29),fill='#aebcd1')
    for i in range(4):d.rounded_rectangle((72+i*56,910,112+i*56,914),radius=2,fill='#9cb5e9' if i==[s[0] for s in scenes].index(name) else '#293549')
    im.convert('RGB').save(OUT/f'{name}-backdrop.png')
    labels.save(OUT/f'{name}-labels.png')
    frame=Image.new('RGBA',(1300,822));ImageDraw.Draw(frame).rounded_rectangle((0,0,1299,821),radius=26,fill='#040a14',outline='#34455f',width=2);frame.save(OUT/'frame.png')
    mask=Image.new('L',(1280,800));ImageDraw.Draw(mask).rounded_rectangle((0,0,1279,799),radius=17,fill=255);mask.save(OUT/'mask.png')
    filters="[0:v]fps=30,format=rgb24,setpts=PTS-STARTPTS[ui];[ui][2:v]alphamerge[rounded];[4:v][rounded]overlay=10:11:shortest=1,format=rgba,fade=t=in:st=0:d=0.35:alpha=1[panel];[3:v]format=rgba,fade=t=in:st=0:d=0.3:alpha=1[labels];[1:v][labels]overlay=x=0:y='20*pow(max(0,1-t/0.65),3)':shortest=1[text];[text][panel]overlay=x='570+32*pow(max(0,1-t/0.75),3)':y=137:shortest=1,format=yuv420p[out]"
    run('-sseof','-6.5','-i',OUT/f'{name}.webm','-loop','1','-i',OUT/f'{name}-backdrop.png','-loop','1','-i',OUT/'mask.png','-loop','1','-i',OUT/f'{name}-labels.png','-loop','1','-i',OUT/'frame.png','-filter_complex',filters,'-map','[out]','-t','6.5','-an','-c:v','libx264','-preset','fast','-crf','20',OUT/f'{name}-edit.mp4')
    print('Rendered',name,flush=True)

# Repeat the first scene so the loop ends on the preceding frame of its start.
parts=['friends','chat','call','screen','friends'];lengths=[6.5]*5;fade=.55
inputs=[]
for part in parts:inputs+=['-i',OUT/f'{part}-edit.mp4']
filters=[f'[{i}:v]fps=30,settb=AVTB,setpts=PTS-STARTPTS[v{i}]' for i in range(len(parts))];total=lengths[0];prev='v0'
for i in range(1,len(parts)):
    offset=total-fade;out=f'x{i}';filters.append(f'[{prev}][v{i}]xfade=transition=smoothleft:duration={fade}:offset={offset:.2f}[{out}]');prev=out;total+=lengths[i]-fade
run(*inputs,'-filter_complex',';'.join(filters),'-map',f'[{prev}]','-an','-c:v','libx264','-preset','fast','-crf','20','-pix_fmt','yuv420p',OUT/'picture.mp4')

# Silent MP4, no audio stream. A compact animation rather than a large GIF.
total=4*(6.5-fade)
run('-ss','0.8','-i',OUT/'picture.mp4','-t',str(total),'-an','-c:v','libx264','-preset','fast','-crf','20','-movflags','+faststart',OUT/'TRLKA-demo-1080p.mp4')
run('-i',OUT/'TRLKA-demo-1080p.mp4','-vf','scale=1280:720','-an','-c:v','libx264','-preset','slow','-crf','23','-movflags','+faststart',ASSETS/'trlka-tour.mp4')

# Honest crops of captured interface, without changing UI styling or text.
shots=ROOT/'output/playwright'
for name in ['friends','chat','call','screen']:
    Image.open(shots/f'marketing-{name}.png').save(ASSETS/f'{name}.webp','WEBP',quality=91,method=6)
crops={'call-detail':('call',(260,50,1265,300)),'chat-detail':('chat',(250,270,1270,745)),'friends-detail':('friends',(294,310,1216,535)),'screen-detail':('screen',(265,225,1255,785))}
for target,(source,box) in crops.items():Image.open(shots/f'marketing-{source}.png').crop(box).save(ASSETS/f'{target}.webp','WEBP',quality=92,method=6)
Image.open(shots/'marketing-invite.png').save(ASSETS/'invite.webp','WEBP',quality=92,method=6)
print(f'Complete: {total:.2f} seconds. Web MP4: {(ASSETS/"trlka-tour.mp4").stat().st_size/1024/1024:.2f} MiB',flush=True)
