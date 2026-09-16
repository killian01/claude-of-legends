"""Re-encode existing Blender renders with English titles and captions."""
import bpy
import json
import shutil
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT/'art_src/models_raw/forest_witch_cleanup'

def main():
    script = OUT/'export_spell_videos.py'
    data = script.read_text(encoding='utf-8')
    changes = {
        'Epine et ricochet': 'Thorn projectile and bounce',
        'Champ de ronces': 'Growing bramble field',
        'Protection et eclatement': 'Shield and thorn burst',
        'Eruption de racines': 'Erupting roots',
        'Sorts - Export temporaire': 'Preview - Temporary Export',
        ' - Rendu': ' - Render', ' - Titre': ' - Title', ' - Sous-titre': ' - Subtitle',
        "text.text=f'{letter}  /  {title}'": "text.text=f'{title}' if letter in ('IDLE','WALK','MORT','AA') else f'{letter}  /  {title}'",
    }
    for old,new in changes.items(): data = data.replace(old,new)
    script.write_text(data,encoding='utf-8')
    lifecycle = OUT/'export_lifecycle.py'
    data2 = lifecycle.read_text(encoding='utf-8')
    for old,new in {
        'RESPIRATION':'BREATHING', 'Posture en appui - boucle':'Planted stance - breathing loop',
        'ATTAQUE AUTOMATIQUE':'BASIC ATTACK', 'Projectile vegetal - cible unique':'Thorn seed - single target',
        'CHUTE':'DEATH', 'Relachement et chute du baton':'Body collapse and dropped staff',
        'Sorts - Export temporaire':'Preview - Temporary Export',
    }.items(): data2 = data2.replace(old,new)
    lifecycle.write_text(data2,encoding='utf-8')
    env = {}; exec(compile(data,str(script),'exec'),env)
    env['SPEC'].update({
        'IDLE':(96,'BREATHING','Planted stance - breathing loop'),
        'WALK':(96,'STAFF WALK','Longer strides - in-place loop'),
        'AA':(74,'BASIC ATTACK','Thorn seed - single target'),
        'MORT':(96,'DEATH','Body collapse and dropped staff'),
    })
    jobs = [
        (['IDLE'],'sylra_idle.mp4',['sorciere_idle.mp4','sorciere_idle_vivant.mp4']),
        (['WALK'],'sylra_walk.mp4',['sorciere_marche_ample.mp4','sorciere_marche_baton.mp4']),
        (['AA'],'sylra_basic_attack.mp4',['sorciere_attaque_auto.mp4']),
        (['MORT'],'sylra_death.mp4',['sorciere_mort.mp4','sorciere_mort_souple.mp4']),
        (['IDLE','WALK'],'sylra_idle_walk.mp4',['sorciere_idle_marche.mp4']),
        (['IDLE','AA','MORT'],'sylra_idle_attack_death.mp4',['sorciere_idle_attaque_mort.mp4']),
        (['Q','W','E','R'],'sylra_spells_QWER.mp4',['sorciere_sorts_QWER.mp4']),
    ] + [([k],f'sylra_{k}_effect.mp4',[f'sorciere_{k}_effet.mp4']) for k in 'QWER']
    reports=[]
    for letters,filename,aliases in jobs:
        for letter in letters:
            expected = env['SPEC'][letter][0]
            assert (OUT/f'apercu_effet_{letter}'/f'vfx_{expected:03d}.png').exists(), (letter,expected)
        reports.append(env['encode'](letters,filename))
        for alias in aliases: shutil.copy2(OUT/filename, OUT/alias)
        print('[English preview]',filename,flush=True)
    scene=bpy.data.scenes.get('Preview - Temporary Export')
    if scene: bpy.data.scenes.remove(scene)
    (OUT/'english_preview_report.json').write_text(json.dumps(reports,indent=2),encoding='utf-8')

if __name__ == '__main__': main()
