/**
 * simonCommands.js
 *
 * Registry of "Simón Dice" game commands: combines body postures and
 * facial expressions/eye signals detected in the Freeze Challenge.
 * Supports enabling/disabling individual commands live from #admin.
 */
import {
  isArmsUp,
  isArmsDown,
  isOneArmUp,
  isTouchingNose,
  isTouchingHead,
  isHeadTilted,
  isArmsCrossed,
} from './simonPoseClassifiers.js';
import {
  isSmiling,
  isMouthOpen,
  isEyebrowsRaised,
  isEyesClosed,
  isMouthPucker,
  isFrowning,
  isWaving,
  isWinking,
} from './ambientSignals.js';

export const SIMON_COMMAND_POOL = [
  // Posturas corporales y manos (PoseLandmarker)
  {
    id: 'arms-up',
    label: 'Brazos arriba',
    icon: '🙌',
    category: 'pose',
    requiresFace: false,
    defaultEnabled: true,
    classifier: (landmarks) => isArmsUp(landmarks),
  },
  {
    id: 'arms-down',
    label: 'Brazos abajo',
    icon: '🧍',
    category: 'pose',
    requiresFace: false,
    defaultEnabled: true,
    classifier: (landmarks) => isArmsDown(landmarks),
  },
  {
    id: 'one-arm-up',
    label: 'Levantá una sola mano',
    icon: '🙋',
    category: 'pose',
    requiresFace: false,
    defaultEnabled: true,
    classifier: (landmarks) => isOneArmUp(landmarks),
  },
  {
    id: 'touch-nose',
    label: 'Tocate la nariz',
    icon: '👃',
    category: 'pose',
    requiresFace: false,
    defaultEnabled: true,
    classifier: (landmarks) => isTouchingNose(landmarks),
  },
  {
    id: 'touch-head',
    label: 'Manos en la cabeza',
    icon: '🤚',
    category: 'pose',
    requiresFace: false,
    defaultEnabled: true,
    classifier: (landmarks) => isTouchingHead(landmarks),
  },
  {
    id: 'head-tilt',
    label: 'Incliná la cabeza',
    icon: '🙆',
    category: 'pose',
    requiresFace: false,
    defaultEnabled: true,
    classifier: (landmarks) => isHeadTilted(landmarks),
  },
  {
    id: 'wave',
    label: 'Saludá con la mano',
    icon: '👋',
    category: 'pose',
    requiresFace: false,
    defaultEnabled: false,
    classifier: (landmarks) => isWaving(landmarks),
  },
  {
    id: 'arms-crossed',
    label: 'Cruzá los brazos',
    icon: '🙅',
    category: 'pose',
    requiresFace: false,
    defaultEnabled: false,
    classifier: (landmarks) => isArmsCrossed(landmarks),
  },

  // Expresiones faciales y ojos (FaceLandmarker — las mismas del Freeze Game)
  {
    id: 'smile',
    label: '¡Sonreí!',
    icon: '😄',
    category: 'face',
    requiresFace: true,
    defaultEnabled: true,
    classifier: (_landmarks, blendshapes) => isSmiling(blendshapes),
  },
  {
    id: 'mouth-open',
    label: 'Abrí grande la boca',
    icon: '😮',
    category: 'face',
    requiresFace: true,
    defaultEnabled: true,
    classifier: (_landmarks, blendshapes) => isMouthOpen(blendshapes),
  },
  {
    id: 'eyebrows-up',
    label: 'Levantá las cejas',
    icon: '🤨',
    category: 'face',
    requiresFace: true,
    defaultEnabled: true,
    classifier: (_landmarks, blendshapes) => isEyebrowsRaised(blendshapes),
  },
  {
    id: 'eyes-closed',
    label: 'Cerrá los ojos',
    icon: '😌',
    category: 'face',
    requiresFace: true,
    defaultEnabled: true,
    classifier: (_landmarks, blendshapes) => isEyesClosed(blendshapes),
  },
  {
    id: 'mouth-pucker',
    label: 'Mandá un beso',
    icon: '😗',
    category: 'face',
    requiresFace: true,
    defaultEnabled: true,
    classifier: (_landmarks, blendshapes) => isMouthPucker(blendshapes),
  },
  {
    id: 'frown',
    label: 'Fruncí el ceño',
    icon: '😠',
    category: 'face',
    requiresFace: true,
    defaultEnabled: true,
    classifier: (_landmarks, blendshapes) => isFrowning(blendshapes),
  },
  {
    id: 'wink',
    label: 'Guiñá un ojo',
    icon: '😉',
    category: 'face',
    requiresFace: true,
    defaultEnabled: false,
    classifier: (_landmarks, blendshapes) => isWinking(blendshapes),
  },
];

export const DEFAULT_DISABLED_COMMANDS = SIMON_COMMAND_POOL
  .filter((c) => !c.defaultEnabled)
  .map((c) => c.id);

let disabledCommandIds = new Set(DEFAULT_DISABLED_COMMANDS);

/**
 * Updates the runtime set of disabled command/signal IDs from #admin.
 */
export function setDisabledCommands(ids) {
  if (Array.isArray(ids)) {
    disabledCommandIds = new Set(ids);
  }
}

export function isCommandEnabled(id) {
  return !disabledCommandIds.has(id);
}

export const SIMON_POSE_ONLY_POOL = SIMON_COMMAND_POOL.filter((c) => !c.requiresFace);

/**
 * Picks a pose-only command when the camera is too far to resolve a face.
 */
export function pickPoseFallbackCommand(excludeId = null) {
  const activePose = SIMON_POSE_ONLY_POOL.filter((c) => isCommandEnabled(c.id));
  const basePool = activePose.length > 0 ? activePose : [SIMON_POSE_ONLY_POOL[0]];
  const candidates = basePool.filter((c) => c.id !== excludeId);
  const pool = candidates.length > 0 ? candidates : basePool;
  return pool[Math.floor(Math.random() * pool.length)];
}

/**
 * Builds a game's command sequence by sampling the active pool, never repeating
 * the same command twice in a row.
 */
export function generateCommandSequence(count, { includeFace = true } = {}) {
  const activeAll = SIMON_COMMAND_POOL.filter((c) => isCommandEnabled(c.id));
  const activePose = activeAll.filter((c) => !c.requiresFace);

  let sourcePool = includeFace ? activeAll : activePose;
  if (sourcePool.length === 0) {
    sourcePool = activeAll.length > 0 ? activeAll : [SIMON_COMMAND_POOL[0]];
  }

  const sequence = [];
  let lastId = null;
  for (let i = 0; i < count; i++) {
    let pick;
    do {
      pick = sourcePool[Math.floor(Math.random() * sourcePool.length)];
    } while (pick.id === lastId && sourcePool.length > 1);
    sequence.push(pick);
    lastId = pick.id;
  }
  return sequence;
}
