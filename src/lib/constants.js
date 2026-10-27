// ─── Game configuration defaults ───────────────────────────────────────────
export const DEFAULT_FREEZE_SECONDS = 5;
export const MIN_FREEZE_SECONDS = 3;
export const MAX_FREEZE_SECONDS = 30;

// Sensitivity levels → movement thresholds (normalized coords 0..1)
// dynamic: frame-window velocity threshold
// anchorDrift: maximum deviation from initial freeze pose
export const SENSITIVITY_LEVELS = {
  low: {
    label: 'Baja',
    threshold: 0.022,
    anchorThreshold: 0.050,
    gestureThreshold: 0.30,
    description: 'Tolerante — pequeños movimientos no penalizan',
  },
  medium: {
    label: 'Media',
    threshold: 0.014,
    anchorThreshold: 0.035,
    gestureThreshold: 0.18,
    description: 'Balanceado — movimiento claro penaliza',
  },
  high: {
    label: 'Alta',
    threshold: 0.008,
    anchorThreshold: 0.022,
    gestureThreshold: 0.10,
    description: 'Estricto — cualquier gesto penaliza',
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

// Minimum pose confidence to consider detection valid
export const MIN_POSE_CONFIDENCE = 0.55;

// Minimum landmark visibility to include it in movement calculation
export const MIN_LANDMARK_VISIBILITY = 0.45;

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

// ─── Anti-flicker / noise rejection ─────────────────────────────────────────
// MediaPipe landmarks jitter by a few thousandths of a normalized unit even
// when the player is perfectly still. These settings keep that jitter from
// being read as real movement.

// Adaptive EMA on incoming landmarks: tiny displacements are smoothed hard,
// genuine movement passes through almost untouched.
//   alpha = min(1, MIN_ALPHA + displacement * GAIN)
export const LANDMARK_SMOOTHING_MIN_ALPHA = 0.25;
export const LANDMARK_SMOOTHING_GAIN = 25;

// How fast a landmark's visibility is allowed to fall. Holding the last good
// position for a frame or two prevents the averaging set (and the centroid)
// from jumping when a landmark briefly drops below the visibility gate.
export const VISIBILITY_DECAY_ALPHA = 0.3;

// Median filter width for the movement score — rejects isolated spikes
// without blunting sustained movement.
export const SCORE_MEDIAN_WINDOW = 5;

// The freeze anchor is averaged over this many frames instead of captured
// from a single (possibly noisy) frame.
export const ANCHOR_SAMPLE_FRAMES = 8;

// Frames to ignore after the analyzer starts, while the smoother converges.
export const ANALYZER_WARMUP_FRAMES = 10;

// A breach must persist this many consecutive frames before it ends the game.
export const BREACH_CONFIRM_FRAMES = 4;

// The pose may vanish for this long (dropped detections) before it counts as
// the player having left the frame.
export const POSE_LOSS_GRACE_MS = 800;


// Landmarks whose coordinates fall outside the frame are MediaPipe
// extrapolating a body part it cannot see. Their positions are invented and
// swing wildly between frames, so they are excluded from the measurement.
// A small margin keeps genuinely edge-of-frame points usable.
export const FRAME_BOUNDS_MARGIN = 0.03;

// A zone only produces a score when at least this fraction of its landmarks
// are usable — otherwise a close-up framing lets one guessed point speak for
// a whole limb.
export const MIN_ZONE_COVERAGE_RATIO = 0.5;

// Reference distances for normalizing movement by apparent body size, so the
// same physical movement scores the same close to or far from the webcam.
// Shoulder width is preferred; head width (ear to ear) is the fallback for
// close-ups, where the shoulders are out of frame or merely guessed.
export const REFERENCE_SHOULDER_WIDTH = 0.22;
export const REFERENCE_HEAD_WIDTH = 0.08;

// Scale clamp. The upper bound is generous because a head-and-shoulders
// close-up really can be several times the reference size, and clamping too
// early leaves that framing twice as sensitive as it should be.
export const MIN_BODY_SCALE = 0.5;
export const MAX_BODY_SCALE = 4.0;


// ─── Per-landmark stability calibration ─────────────────────────────────────
// Visibility and frame bounds are not enough to tell an observed landmark from
// one MediaPipe is inferring: it reports confident-looking positions for elbows
// and hips it has never seen, and those positions keep jittering. That jitter
// is CONSTANT, not spiky, so neither temporal median nor breach confirmation
// filters it — it just sits above the threshold and ends the round instantly.
//
// So the analyzer measures each landmark for itself over the opening frames and
// drops the ones that will not hold still relative to the rest of the body.
export const STABILITY_CALIBRATION_FRAMES = 10;

// A landmark is unstable when its mean frame-to-frame movement during
// calibration exceeds this multiple of the body median...
export const UNSTABLE_RELATIVE_FACTOR = 3.0;

// ...and also clears this absolute floor, so that a genuinely motionless body
// (where the median is near zero) does not flag every landmark it has.
export const UNSTABLE_ABSOLUTE_FLOOR = 0.004;


// ─── Signs-of-life monitoring (C.U.I.D.A. vitality demo) ────────────────────
// Face mesh with blendshapes: 52 expression scores per frame, which is what
// makes blink and micro-gesture detection possible. Pose landmarks give only
// five coarse face points and cannot see an eyelid.
export const MEDIAPIPE_FACE_MODEL_URL = '/models/face_landmarker.task';

// Blink: the eye-closed blendshape crossing up, then back down past a lower
// release value, so a score hovering at the line is one blink and not twenty.
export const BLINK_THRESHOLD = 0.45;
export const BLINK_RELEASE = 0.25;
export const BLINK_RATE_WINDOW_MS = 60000;

// A resting adult blinks about 12-20 times a minute; below this suggests a
// fixed stare, which is itself worth surfacing.
export const BLINK_RATE_LOW = 6;
export const BLINK_RATE_NORMAL = 12;

// Expression: blendshapes that move when someone speaks, grimaces or reacts.
// Deliberately excludes the blink shapes, which are counted on their own.
export const EXPRESSION_BLENDSHAPES = [
  'jawOpen',
  'mouthSmileLeft',
  'mouthSmileRight',
  'mouthPucker',
  'mouthFrownLeft',
  'mouthFrownRight',
  'browInnerUp',
  'browDownLeft',
  'browDownRight',
  'cheekSquintLeft',
  'cheekSquintRight',
  'noseSneerLeft',
  'noseSneerRight',
];
export const EXPRESSION_WINDOW_FRAMES = 90;   // ~3s at 30fps
export const EXPRESSION_ACTIVE_STD = 0.012;

// Head motion: nose position normalized by head width, spread over ~2s.
// Set just above the detector noise floor, so an awake person holding still
// still registers while a propped-up head does not.
export const HEAD_MOTION_WINDOW_FRAMES = 60;
export const HEAD_MOTION_ACTIVE = 0.006;

// Breathing: found by periodicity, not amplitude. The window must hold at
// least two full cycles at the slowest rate searched for.
export const BREATHING_WINDOW_FRAMES = 600;   // ~20s at 30fps
export const BREATHING_MIN_RPM = 8;
export const BREATHING_MAX_RPM = 30;
export const BREATHING_MIN_CONFIDENCE = 0.35;

// How long without any sign of consciousness before the state escalates.
export const VITALITY_STILL_MS = 8000;
export const VITALITY_ALERT_MS = 20000;


// ─── Facial gesture detection (game) ────────────────────────────────────────
// Blendshape scores are 0..1 and far less noisy than landmark positions, so
// these windows are shorter than the body ones.
export const GESTURE_MEDIAN_WINDOW = 5;
export const GESTURE_CALIBRATION_FRAMES = 12;

// A gesture must hold this many consecutive frames to end the round, the same
// confirmation the body movement gets.
export const GESTURE_CONFIRM_FRAMES = 4;
