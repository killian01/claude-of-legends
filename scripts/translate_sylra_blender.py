"""Translate the editable Sylra source labels and notes, preserving animation data."""
import bpy
import json
import shutil
from pathlib import Path

REPLACEMENTS = {
    'Idle - Respiration': 'Idle - Breathing', 'Marche - Baton': 'Walk - Staff',
    'AA - Attaque automatique': 'AA - Basic Attack', 'Mort - Chute': 'Death - Collapse',
    'Apercu - Marche': 'Preview - Walk', 'W_CTRL - Centre du champ': 'W_FieldCenter',
    'W - Effet de ronces': 'W - Bramble Effects',
    'W - Entrelacs de racines': 'W_RootBed', 'W - Nervures des racines': 'W_RootVeins',
    'W - Limite organique du champ': 'W_OrganicBoundary', 'W - Racines de seve': 'W_SapRoots',
    'W - Bourgeons du cercle': 'W_LeafSigils', 'W - 70 spores ascendantes': 'W_RisingPollen',
    'W - Petales en suspension': 'W_DriftingPetals', 'W - Graine enchantee ': 'W_EnchantedSeed_',
    'AA - Graine projectile ': 'AA_SeedProjectile_', 'W_Ronce_': 'W_Bramble_',
    'Attaque_Automatique': 'Basic_Attack', 'Mort_Souple': 'Death_Soft',
    'Mort_Chute': 'Death_Fall', 'Idle_Boucle': 'Idle_Loop',
    'Marche_Baton': 'Walk_Staff', 'Marche_Boucle': 'Walk_Loop',
    'avant_amplification': 'before_amplification', 'avant_revision': 'before_revision',
    'Tete_et_cheveux': 'Head_and_Hair', 'Torse_et_ceinture': 'Torso_and_Belt',
    'Jupe_et_pans': 'Skirt_and_Panels', 'Bras_gauche': 'Arm_Left', 'Bras_droit': 'Arm_Right',
    'Jambe_gauche': 'Leg_Left', 'Jambe_droite': 'Leg_Right', 'Chapeau': 'Hat',
    'Sorciere': 'Sylra', 'Baton': 'Staff', 'MORT': 'DEATH', 'Mort': 'Death',
    'Tissu - Contact sol': 'Cloth - Ground Contact', 'Graine projectile': 'Seed Projectile',
    'Onde ': 'Wave ',
    'Contour froid': 'Cool Rim Light', 'Key chaude': 'Warm Key Light',
    'Plateau ardoise': 'Slate Platform', 'Visage': 'Face Light',
    'Cible unique': 'Single Target', 'Impact au sol': 'Ground Impact', 'Impact leger': 'Light Impact',
    'Lueur magique': 'Magic Glow', 'Coeur de la protection': 'Shield Core',
    'Coque translucide': 'Translucent Shell', 'Eclats du bouclier': 'Shield Shards',
    'Epine de rupture': 'Burst Thorn', 'Feuilles du rempart': 'Shield Leaves',
    'Naissance du bouclier': 'Shield Formation', 'Nervures protectrices': 'Protective Veins',
    'Onde de rupture': 'Burst Wave', 'Poussiere de la chute': 'Fall Dust',
    'Epine projectile': 'Thorn Projectile', 'Impact du rebond': 'Bounce Impact',
    'Impact principal': 'Primary Impact', 'Repere cible': 'Target Marker',
    'Vrille du sillage': 'Trail Tendril', 'Sillage': 'Trail', 'Rebond': 'Bounce',
    'Centre Overgrowth': 'Overgrowth Center', 'Cercle de presage': 'Warning Circle',
    'Explosion de pollen': 'Pollen Burst', 'Fissures lumineuses': 'Glowing Cracks',
    'Graine primordiale': 'Primal Seed', 'Onde de l eruption': 'Eruption Wave',
    'Racine geante': 'Giant Root', 'Racines dechirees': 'Torn Roots',
    'Retombee de spores': 'Falling Spores', 'Reverberation': 'Afterglow',
    'Seve convergente': 'Converging Sap', 'Eclat du baton': 'Staff Flash',
    'Lumiere du champ': 'Field Light', 'Transmission au sol': 'Ground Conduit',
    'Voile de brume': 'Mist Veil', 'Brume au sol': 'Ground Mist',
    'Lumiere et camera': 'Lights and Camera', 'Ronces et feuilles': 'Brambles and Leaves',
    'Sceaux et energie': 'Sigils and Energy', 'Spores et petales': 'Spores and Petals',
    'Personnage': 'Character', '8 parties': '8 Parts', 'accessoires': 'Accessories',
    'Effet Attaque automatique': 'Basic Attack Effects', 'Effet Respiration': 'Breathing Effects',
    'Effet Chute': 'Fall Effects', 'Effet Baton': 'Staff Effects', 'Effet ': 'Effects ',
    'Cible d entrainement': 'Training Target', 'Energie emeraude': 'Emerald Energy',
    'Pollen dore': 'Golden Pollen', 'Liseres du rempart': 'Shield Edges',
    'Membrane de seve': 'Sap Membrane', 'Poussiere vegetale': 'Plant Dust',
    'Cible spectrale': 'Spectral Target', 'Cercle emeraude': 'Emerald Circle',
    'Coeur des graines': 'Seed Cores', 'Ecorce epineuse': 'Thorny Bark',
    'Etincelles pollen': 'Pollen Sparks', 'Feuilles emeraude': 'Emerald Leaves',
    'Jeunes pousses': 'Young Shoots', 'Pointes dorees': 'Golden Tips',
    'Seve lumineuse': 'Glowing Sap', 'Seve souterraine': 'Underground Sap',
    'Sol ardoise': 'Slate Ground', 'Halo composite': 'Glow Composite',
    'Contact des tissus avec le sol': 'Cloth Ground Contact',
    'Apercu': 'Preview', 'Sol': 'Ground', 'Doigts': 'Fingers', 'Robe et cheveux': 'Robe and Hair',
    'AA - Tir (0,35 s)': 'AA - Release (0.35 s)', 'Deuxieme attaque': 'Second Attack',
    'Explosion apres 2,5 s': 'Burst after 2.5 s', 'Idle - Debut': 'Idle - Start',
    'Inspiration et appui gauche': 'Inhale and Left Weight Shift',
    'Expiration et appui droit': 'Exhale and Right Weight Shift',
    'Contact pied gauche / baton': 'Left Foot / Staff Contact',
    'Retour pied droit': 'Right Foot Recovery', 'Contact pied droit': 'Right Foot Contact',
    'Levee baton': 'Staff Lift', 'Retour pied gauche / baton': 'Left Foot / Staff Recovery',
    'Boucle suivante': 'Next Loop', 'Genoux cedent': 'Knees Buckle', 'Baton lache': 'Staff Release',
    'Main au sol': 'Hand Ground Contact', 'Bassin au sol': 'Hips Ground Contact',
    'Epaule': 'Shoulder', 'Tete': 'Head', 'Immobilisation': 'Settle',
    'Premier impact': 'First Impact', 'Presage': 'Warning', 'Eruption apres 1,25 s': 'Eruption after 1.25 s',
    'Fin de l enracinement': 'Root Ends', 'Appui / invocation': 'Plant Staff / Cast',
    'Levee des ronces': 'Bramble Growth', 'Garde retrouvee': 'Guard Restored',
    'Impact et naissance': 'Impact and Growth', 'Champ deploye': 'Field Fully Grown',
    'Fin des 4 secondes': 'Four Seconds End', 'Preparation': 'Windup',
    'Garde': 'Guard', 'Retour': 'Recovery', 'Fermeture': 'Loop Closure', 'Tir': 'Release',
}

PROPERTIES = {
    'Baton relache image 18, chute et petit rebond, puis immobilisation au sol.': 'Staff released on frame 18, followed by a fall, a small bounce and rest on the ground.',
    'Baton tenu en main droite et utilise comme une canne.': 'Staff held in the right hand and used as a walking cane.',
    'Bras droit': 'Right arm', 'Bras gauche': 'Left arm', 'Jambe droite': 'Right leg',
    'Jambe gauche': 'Left leg', 'Jupe et pans': 'Skirt and panels',
    'Main droite : DEF-hand.R': 'Right hand: DEF-hand.R',
    'Poids par region anatomique, normalises, 4 influences maximum.': 'Normalized anatomical weights, with at most four influences per vertex.',
    'Rig corps, doigts, robe et cheveux. 75 os de deformation.': 'Body, finger, robe and hair rig. 75 deform bones.',
    'Spell W / Bramble Field. Action ponctuelle 1-49, 24 images/s, retour en garde.': 'W / Bramble Field. One-shot action, frames 1-49 at 24 fps, returning to guard.',
    'Tete et cheveux': 'Head and hair', 'Torse et ceinture': 'Torso and belt',
}

NOTES = {
 'Baton': ('Staff', '''SYLRA - STAFF WALK
Scene: Walk - Staff. Action: Sylra_Walk_Staff_32f.
In-place loop, frames 1-32 at 24 fps; frame 33 closes the loop.
Staff_Sylra is parented to DEF-hand.R. The right hand stays closed around the shaft.
The staff plants with the left foot, supports the step, then lifts and returns forward.
Its planted tip travels backward with the feet during the in-place cycle.
Uniform staff scale: 1.10. Edit hand_ik.R and the right finger controls in Pose Mode.
The earlier staff-free walk is preserved as Sylra_Walk_Loop_32f.
Preview - Walk shares the current walk rig. See README_IDLE_WALK_AMPLIFIED.
'''),
 'Effet_W': ('W_Effect', '''SYLRA - W / BRAMBLE FIELD EFFECT
Scene: W - Bramble Field. Collection: W - Bramble Effects.
Move W_FieldCenter to position the entire field.
24 branched brambles with leaves and thorns, seven seeds, roots, organic boundary,
eight pulses at 0.5-second intervals, 70 pollen particles and 14 petals.
Growth uses absolute shape keys. No external simulation cache is required.
24 fps: frame 12 activation, frame 26 full growth, frame 108 end of the four-second field,
frame 124 end of dissipation. Preview length: 144 frames / six seconds.
The character plays the original two-second W action, then holds guard.
EEVEE and the compositor provide the preview glow. Textures are packed.
The game exports brambles, roots, seeds and particle morph poses through
scripts/export_sylra_effects.py. Game pulses and the gameplay boundary are rendered separately.
'''),
 'IDLE_ATTAQUE_MORT': ('IDLE_ATTACK_DEATH', '''SYLRA - IDLE, BASIC ATTACK AND DEATH
Choose a scene using Blender's scene selector, then press Space to play. 24 fps.
Idle - Breathing: Sylra_Idle_Loop_96f, frames 1-96, closing key at 97.
Visible breathing, weight shifts, head, free hand and cloth motion; feet and staff stay planted.
AA - Basic Attack: Sylra_Basic_Attack_37f, frames 1-37, closing key at 38.
Release is frame 9.4 / 0.35 seconds. A thorn seed flies from the staff to one target.
The 74-frame preview shows two attacks at approximately the base 0.65 attacks/second.
Death - Collapse: Sylra_Death_Soft_72f, movement frames 1-73, final pose held through 96.
The knees buckle, the body falls sideways and limbs settle independently.
DEATH_Staff_Sylra releases at frame 18 and uses a separate animation track.
The robe and hat have a Blender ground-contact modifier after the armature.
The root stays fixed. No simulation cache is required. See README_DEATH_SOFT.
English previews: sylra_idle.mp4, sylra_basic_attack.mp4, sylra_death.mp4,
and sylra_idle_attack_death.mp4.
'''),
 'IDLE_MARCHE_AMPLIFIES': ('IDLE_WALK_AMPLIFIED', '''SYLRA - AMPLIFIED IDLE AND WALK
Idle - Breathing: Sylra_Idle_Loop_96f. Frames 1-96, closing key 97, 24 fps.
Visible breathing (0.024 vertical pelvis excursion), weight shifts, gaze,
free-hand movement and delayed cloth motion. Feet and staff tip remain planted.
Walk - Staff: Sylra_Walk_Staff_32f. Frames 1-32, closing key 33, 24 fps.
In-place walk with 0.325 foot travel, compared with 0.164 previously (1.98 times).
Higher foot lift, left-arm swing and pelvis movement accompany the longer steps.
The staff returns forward and supports the left-foot contact.
The walk has its own rig, also used by Preview - Walk.
Previous actions use the suffix before_amplification.
English previews: sylra_idle.mp4, sylra_walk.mp4, sylra_idle_walk.mp4.
'''),
 'Marche': ('Walk', '''SYLRA - WALK CYCLE
Current version: Walk - Staff, Sylra_Walk_Staff_32f. See README_IDLE_WALK_AMPLIFIED.
Earlier staff-free action: Sylra_Walk_Loop_32f.
In-place loop, frames 1-32 at 24 fps (1.333 seconds), closing key 33.
Press Space in the 3D View or Timeline. Edit rig controls in Pose Mode.
Cycles modifiers repeat the curves. The root remains stationary.
Alternating steps animate feet, pelvis, torso, arms, fingers, robe and hair.
Preview - Walk contains the preview camera and ground.
The game export increases walk cadence separately from the source animation.
'''),
 'MORT_SOUPLE': ('DEATH_SOFT', '''SYLRA - ARTICULATED DEATH REVISION
Scene: Death - Collapse. Action: Sylra_Death_Soft_72f.
24 fps; movement 1-73, preview 1-96.
Asymmetric knee collapse, waist bend, hips landing before the shoulder.
The head and arms continue after impact; cloth settles and the character becomes still.
Root remains fixed. Torso, chest, hips, neck, head and all four limb IK controls
follow independent paths. Knee and elbow poles are animated without limb stretching.
The staff releases on frame 18 and follows its own track.
Previous versions remain in the backup file and Sylra_Death_72f / before_revision actions.
All animation keys are stored in the file. Preview: sylra_death.mp4.
'''),
 'Regroupement': ('Grouping', '''SYLRA - MESH GROUPING
116 imported objects grouped into eight editable body parts.
Imported textures, UVs, geometry and normals are preserved.
Decorative details are attached to their anatomical regions.
Left and right refer to the character's own sides.
The segment_origine face attribute preserves the original Tripo segment numbers.
The original source and grouping report remain beside this file as historical backups.
'''),
 'Rig': ('Rig', '''SYLRA - HUMANOID RIG
Eight textured meshes, 75 deform bones, plus Rigify controls and mechanisms.
Select Sylra_RIG and enter Pose Mode. Each animation scene has its own rig copy.
root: move the whole character. torso / hips / chest: pelvis and torso.
head / neck: head and neck; the hat follows the head.
hand_ik.L / .R: move hands with G. foot_ik.L / .R: move feet with G.
foot_heel_ik.L / .R: foot roll. Arm / Leg (FK): direct joint rotation.
IK/FK blend controls are on upper_arm_parent and thigh_parent.
Show the Fingers bone collection for finger controls; scale *_master along Y to curl.
Robe and Hair contains 16 robe controls and four hair controls.
Adjust robe controls manually to fit leg poses. Detail collections start hidden.
Find them in Armature Data Properties > Bone Collections.
Sylra_Metarig is preserved and hidden. Vertex weights remain editable in Weight Paint.
No facial rig. Technical bone identifiers are preserved for Rigify compatibility.
'''),
 'SORTS_COMPLETS': ('ALL_SPELLS', '''SYLRA - Q / W / E / R
Choose a scene from Blender's scene selector. Each has its character, action, effects and camera.
Separate rigs share character geometry and textures. All scenes use 24 fps.
Q - Thorn Bolt: 72-frame / three-second preview. Release 12, first hit 19, bounce 26.
Two dark markers are demonstration targets. The basic attack does not bounce.
W - Bramble Field: 144-frame / six-second preview, four-second active field.
E - Verdant Shell: 108-frame / 4.5-second preview. Shield at 12, burst at 72 after 2.5 seconds.
Translucent shell, plant veins, thorns and a ground wave.
R - Overgrowth: 132-frame / 5.5-second preview. Warning 12, eruption 42 after 1.25 seconds,
giant roots and pollen, withdrawal from 80. This preview shows the base ultimate.
Character clips return to guard. The staff stays parented to DEF-hand.R.
Effects use keys, curves and shape keys; no external simulation caches.
EEVEE and compositor glow; packed textures. English reel: sylra_spells_QWER.mp4.
Game clips are exported with scripts/export_sylra.py; AA and W effects use export_sylra_effects.py.
'''),
 'Spell_W': ('W_Cast', '''SYLRA - W / BRAMBLE FIELD CAST
Action: Sylra_W_Bramble_Field_48f. Two seconds, frames 1-49 at 24 fps.
One-shot action, constant extrapolation, no Cycles modifier.
1 guard; 8 windup; 12 staff plant and ground gesture; 24 hand lift; 35 recovery; 49 guard.
The staff stays in the right hand, parented to DEF-hand.R, with fixed contact on frames 12-29.
Feet remain planted and the root stays fixed. Fingers, torso, head, robe and hair follow the gesture.
The character clip casts a four-second gameplay field. Gameplay activation is immediate;
the artistic frame-12 growth cue does not delay damage or change simulation rules.
The game keeps the full gesture duration and allows movement to interrupt recovery.
Preview scene: W - Bramble Field. Preview: sylra_W_effect.mp4.
'''),
}

def translated(value):
    if value in PROPERTIES:
        return PROPERTIES[value]
    for old, new in sorted(REPLACEMENTS.items(), key=lambda pair: -len(pair[0])):
        value = value.replace(old, new)
    return value

def main():
    path = Path(bpy.data.filepath)
    backup = path.with_name('forest_witch_before_english_names.blend')
    if not backup.exists(): shutil.copy2(path, backup)
    mapping_path = path.parent/'english_name_mapping.json'
    changes = json.loads(mapping_path.read_text(encoding='utf-8')) if mapping_path.exists() else {}
    # Data-block references use Blender pointers. Leave rig bone identifiers and
    # generated Rigify Python unchanged so constraints and controls remain valid.
    for kind in ['scenes','actions','objects','collections','materials','meshes','curves','armatures','node_groups','cameras','lights','worlds']:
        for item in list(getattr(bpy.data, kind)):
            old = item.name; new = translated(old)
            if old == 'Scene' and kind == 'scenes': new = 'Character'
            if new != old:
                item.name = new; changes[old] = item.name
            for key in list(item.keys()):
                value = item[key]
                if isinstance(value,str) and not value.startswith(('C:', 'tripo_')):
                    item[key] = translated(value)
    for scene in bpy.data.scenes:
        for marker in scene.timeline_markers: marker.name = translated(marker.name)
    for arm in bpy.data.armatures:
        for collection in arm.collections_all: collection.name = translated(collection.name)
    for obj in bpy.data.objects:
        for modifier in obj.modifiers: modifier.name = translated(modifier.name)
        for constraint in obj.constraints: constraint.name = translated(constraint.name)
    for old, (name, contents) in NOTES.items():
        text = bpy.data.texts.get('LIRE_MOI_' + old)
        if text:
            text.name = 'README_' + name; text.clear(); text.write(contents)
    (path.parent/'english_name_mapping.json').write_text(json.dumps(changes,indent=2),encoding='utf-8')
    # Preserve exact references used by the maintained export pipeline and docs.
    root = path.parents[3]
    for relative in ['scripts/export_sylra.py','scripts/export_sylra_effects.py','docs/sylra-model.md']:
        target = root/relative
        data = target.read_text(encoding='utf-8')
        for old,new in sorted(changes.items(),key=lambda pair:-len(pair[0])):
            data = data.replace(old,new)
        target.write_text(data,encoding='utf-8')
    bpy.ops.wm.save_as_mainfile(filepath=str(path))
    print(json.dumps({'renamed':len(changes),'notes':len(NOTES),'scenes':[s.name for s in bpy.data.scenes]}))

if __name__ == '__main__': main()
