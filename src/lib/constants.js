// ─── Game configuration defaults ───────────────────────────────────────────
export const DEFAULT_FREEZE_SECONDS = 5;
export const MIN_FREEZE_SECONDS = 3;
export const MAX_FREEZE_SECONDS = 30;

// Sensitivity levels → movement thresholds (normalized coords 0..1)
// dynamic: frame-window velocity threshold
// anchorDrift: maximum deviation from initial freeze pose
// visibilityGraceMs: how long the torso may be out of view (tracking dropout,
//   partial occlusion) before it counts as leaving the frame
export const SENSITIVITY_LEVELS = {
  low: {
    label: 'Baja',
    threshold: 0.022,
    anchorThreshold: 0.050,
    visibilityGraceMs: 1000,
    description: 'Tolerante — pequeños movimientos no penalizan',
  },
  medium: {
    label: 'Media',
    threshold: 0.014,
    anchorThreshold: 0.035,
    visibilityGraceMs: 600,
    description: 'Balanceado — movimiento claro penaliza',
  },
  high: {
    label: 'Alta',
    threshold: 0.008,
    anchorThreshold: 0.022,
    visibilityGraceMs: 300,
    description: 'Estricto — cualquier movimiento penaliza',
  },
};
export const DEFAULT_SENSITIVITY = 'medium';

// ─── Anatomical zones for balanced multi-zone detection ──────────────────────
// Head: nose, eyes, ears (captures nod, turn, tilt)
export const HEAD_LANDMARK_INDICES = [0, 1, 4, 7, 8];

// Torso / body core: shoulders and hips (captures leans, steps, torso rotation)
export const TORSO_LANDMARK_INDICES = [11, 12, 23, 24];

// Arms: elbows and wrists (captures gestures and hand movement)
export const ARMS_LANDMARK_INDICES = [13, 14, 15, 16];

// Legs: knees and ankles (captures footwork, crouching)
export const LEGS_LANDMARK_INDICES = [25, 26, 27, 28];

// Complete set of tracked landmarks
export const TRACKED_LANDMARK_INDICES = [
  ...HEAD_LANDMARK_INDICES,
  ...TORSO_LANDMARK_INDICES,
  ...ARMS_LANDMARK_INDICES,
  ...LEGS_LANDMARK_INDICES,
];

// Zone sensitivity weights to compensate for anatomical lever arm differences
export const ZONE_WEIGHTS = {
  head: 1.4,      // Head movements have shorter radius than arms
  torso: 1.6,     // Torso/centroid displacement represents full-body motion
  arms: 1.0,      // Baseline reference (long lever arms)
  legs: 1.2,      // Lower body shifts
};

// Window size for short-term velocity calculation (frames, ~150ms at 30fps)
export const MOVEMENT_WINDOW_FRAMES = 5;

// Landmark smoothing against model jitter (0..1): lower = smoother but slower to react;
// 1 = no smoothing. Arms get more: wrists and elbows are the model's noisiest points
export const LANDMARK_SMOOTHING = 0.5;
export const ARM_LANDMARK_SMOOTHING = 0.25;

// Minimum pose confidence to consider detection valid
export const MIN_POSE_CONFIDENCE = 0.55;

// Minimum landmark visibility to consider a point present (shoulders in frame, torso in view)
export const MIN_LANDMARK_VISIBILITY = 0.65;

// How well the model can estimate a point, from its visibility: below LOW it's a guess
// (e.g. a hand behind a desk) and is ignored, above HIGH it's clearly seen, in between it
// counts proportionally — both in movement detection and in how fast its smoothed position
// follows new readings — instead of a hard in/out cutoff
export const CONFIDENCE_LOW_VISIBILITY = 0.5;
export const CONFIDENCE_HIGH_VISIBILITY = 0.9;

// Landmarks that must be visible to play: both shoulders, seen whether standing or seated
export const REQUIRED_LANDMARK_INDICES = [11, 12];

// Only body parts at least this visible in the starting freeze pose are judged during
// play: half-hidden ones (e.g. hands behind a desk) are ignored for the round. Torso parts
// among them must stay in view; hips hidden at the start (player seated) aren't required.
export const ANCHOR_MIN_VISIBILITY = 0.75;

// MediaPipe model, served locally from public/models (works offline)
export const MEDIAPIPE_MODEL_URL = '/models/pose_landmarker_lite.task';

// C.U.I.D.A. branding
export const CUIDA_FULL_NAME = 'C.U.I.D.A.';
export const CUIDA_SUBTITLE = 'Sistema de monitoreo inteligente de adultos mayores';
export const GAME_TITLE = 'Freeze Challenge';
export const GAME_DESCRIPTION = 'Demostración interactiva del sistema de detección de movimiento de C.U.I.D.A.';

// Detection box colors per state — aligned with design token palette
export const BOX_COLORS = {
  detecting: '#5b9cf5',  // --signal (azul desaturado)
  ready:     '#e8aa42',  // --accent-yellow refinado
  playing:   '#3dd68c',  // --pulse (verde cálido)
  lost:      '#e05c5c',  // --accent-red refinado
  won:       '#3dd68c',  // --pulse (verde cálido)
};
