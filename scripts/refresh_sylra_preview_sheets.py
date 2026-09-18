"""Build English contact sheets from existing renders and English video exports."""
from pathlib import Path
import cv2
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[1]/'art_src/models_raw/forest_witch_cleanup'

def sheet(filename, rows):
    columns=max(len(samples) for _,samples in rows)
    out=Image.new('RGB',(336*columns,306*len(rows)),(12,20,25))
    draw=ImageDraw.Draw(out)
    for row,(key,samples) in enumerate(rows):
        label={'MORT':'DEATH','AA':'BASIC ATTACK','WALK':'STAFF WALK','IDLE':'BREATHING'}.get(key,key)
        for col,frame in enumerate(samples):
            source=ROOT/f'apercu_effet_{key}'/f'vfx_{frame:03d}.png'
            image=Image.open(source).convert('RGB');image.thumbnail((336,280))
            x=col*336;y=row*306
            out.paste(image,(x,y));draw.text((x+10,y+285),f'{label} - Frame {frame}',fill=(202,238,208))
    out.save(ROOT/filename,quality=94)

def video_frame(name,frame):
    capture=cv2.VideoCapture(str(ROOT/name));capture.set(cv2.CAP_PROP_POS_FRAMES,frame)
    ok,pixels=capture.read();capture.release();assert ok,name
    return Image.fromarray(cv2.cvtColor(pixels,cv2.COLOR_BGR2RGB))

def main():
    sheet('controle_idle_marche_amplifies.jpg',[('IDLE',[1,25,49,73]),('WALK',[1,9,17,25])])
    sheet('controle_idle_marche_final.jpg',[('IDLE',[1,33,65]),('WALK',[1,12,24])])
    for name in ['controle_mort_revision.jpg','controle_mort_souple_final.jpg']:
        sheet(name,[('MORT',[1,13,25,37]),('MORT',[44,53,65,73])])
    sheet('controle_QER.jpg',[('Q',[16,23,30]),('E',[14,40,78]),('R',[30,49,90])])
    for name,spec in {
        'controle_videos_idle_attaque_mort.jpg':[('sylra_idle.mp4',24),('sylra_basic_attack.mp4',12),('sylra_death.mp4',75)],
        'controle_videos_QER.jpg':[(f'sylra_{key}_effect.mp4',frame) for key,frame in [('Q',18),('E',42),('R',52)]],
    }.items():
        out=Image.new('RGB',(672*len(spec),560))
        for i,(video,frame) in enumerate(spec):out.paste(video_frame(video,frame),(i*672,0))
        out.save(ROOT/name,quality=94)
    for name,video,frame in [
        ('verification_decode_idle_amplifie.jpg','sylra_idle.mp4',24),
        ('verification_decode_walk_amplifie.jpg','sylra_walk.mp4',24),
        ('verification_mort_souple_decode.jpg','sylra_death.mp4',75),
    ]:video_frame(video,frame).save(ROOT/name,quality=94)
    # Keep the contact-sheet generators English for later preview revisions.
    for name in ['make_walk_preview.py','make_spell_preview.py','make_w_vfx_preview.py','verify_spell_frames.py']:
        path=ROOT/name
        data=path.read_text(encoding='utf-8').replace(' - Image ', ' - Frame ').replace(' - IMAGE ', ' - FRAME ').replace("f'Image ","f'Frame ")
        path.write_text(data,encoding='utf-8')
    # Replace only labels in the existing raw-render contact sheets by rebuilding
    # their rows from the same image sequences, without touching render pixels.
    sheet('apercu_effet_W/controle_effet_final.jpg',[('W',[1,16,24,36]),('W',[60,96,116,132])])
    print('English contact sheets and decoded video stills refreshed.')

if __name__=='__main__':main()
