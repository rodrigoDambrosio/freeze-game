// ─── Game configuration defaults ───────────────────────────────────────────
// The challenge is to keep C.U.I.D.A. from detecting any sign of life. The
// round has to run long enough for every detector to have its say —
// breathing rate in particular needs about fifteen seconds of signal — so
// twenty seconds is the default, though the admin can shorten it for tests.
export const DEFAULT_FREEZE_SECONDS = 20;
export const MIN_FREEZE_SECONDS = 5;
export const MAX_FREEZE_SECONDS = 60;

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

// Noisy distal sub-landmarks (fingers: pinky/index/thumb, feet: heel/toes)
// that MediaPipe Pose Lite frequently hallucinates under partial occlusion.
export const DISTAL_EXTREMITY_INDICES = [17, 18, 19, 20, 21, 22, 29, 30, 31, 32];

// Zone name → landmark indices, for replay highlighting and displacement lookup
export const ZONE_LANDMARK_INDICES = {
  head: HEAD_LANDMARK_INDICES,
  torso: TORSO_LANDMARK_INDICES,
  arms: ARMS_LANDMARK_INDICES,
  legs: LEGS_LANDMARK_INDICES,
};

export const ZONE_DISPLAY_LABELS = {
  head: 'Cabeza',
  torso: 'Cuerpo',
  arms: 'Brazos',
  legs: 'Piernas',
};

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

// Minimum landmark visibility to include it in movement calculation & skeleton drawing
export const MIN_LANDMARK_VISIBILITY = 0.55;

// Default skeleton & keypoint smoothing and occlusion settings for expo stability
export const DEFAULT_POSE_SMOOTHING = 0.68;
export const DEFAULT_OCCLUSION_DAMPING = true;
export const DEFAULT_OCCLUSION_HOLD_MS = 350;
export const DEFAULT_HIDE_NOISY_EXTREMITIES = true;

// MediaPipe model, served locally from public/models (works offline)
export const MEDIAPIPE_MODEL_URL = '/models/pose_landmarker_lite.task';

// GPU / CPU Inference delegate & Pose model variants configurable from #admin
export const INFERENCE_DELEGATES = ['GPU', 'GPU_LOW_POWER', 'CPU'];
export const DEFAULT_INFERENCE_DELEGATE = 'GPU';

export const POSE_MODEL_VARIANTS = {
  lite: {
    label: 'Lite (Rápido / Local)',
    url: '/models/pose_landmarker_lite.task',
    description: 'Incluido offline · muy liviano',
  },
  full: {
    label: 'Full (Preciso · GPU)',
    url: '/models/pose_landmarker_full.task',
    description: 'Mayor estabilidad ante oclusiones (se descarga y cachea en local)',
  },
  heavy: {
    label: 'Heavy (Máximo · GPU dedicada)',
    url: '/models/pose_landmarker_heavy.task',
    description: 'Máxima precisión anatómica para placas dedicadas',
  },
};
export const DEFAULT_POSE_MODEL_VARIANT = 'lite';

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
  finished:  '#3dd68c',  // --pulse (verde cálido) — cierre de una partida de Simón Dice
};

// ─── Anti-flicker / noise rejection ─────────────────────────────────────────
// MediaPipe landmarks jitter by a few thousandths of a normalized unit even
// when the player is perfectly still. These settings keep that jitter from
// being read as real movement.

// Adaptive EMA on incoming landmarks: tiny displacements are smoothed hard,
// genuine movement passes through almost untouched.
//   alpha = min(1, MIN_ALPHA + displacement * GAIN)
export const LANDMARK_SMOOTHING_MIN_ALPHA = 0.18;
export const LANDMARK_SMOOTHING_GAIN = 14;

// Residual normalized jitter that is ignored by both velocity and anchor
// drift. This prevents a static image or a motionless player from losing to
// sub-pixel landmark noise while preserving deliberate movement.
export const LANDMARK_NOISE_FLOOR = 0.0025;

// How fast a landmark's visibility is allowed to fall. Holding the last good
// position for a frame or two prevents the averaging set (and the centroid)
// from jumping when a landmark briefly drops below the visibility gate.
export const VISIBILITY_DECAY_ALPHA = 0.22;

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
// least two full cycles at the slowest rate searched for. The upper end
// reaches past normal into tachypnoea: a rate that high is the most
// alarming case, so it must be inside the search range, not above it.
export const BREATHING_WINDOW_FRAMES = 600;   // ~20s at 30fps
export const BREATHING_MIN_RPM = 8;
export const BREATHING_MAX_RPM = 40;
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


// ─── Blink budget & breathing in the game ───────────────────────────────────
// A blink budget makes an involuntary reflex playable: not "do not blink",
// which is unwinnable, but "hold out without blinking too much". A resting
// adult blinks 12-20 times a minute, so the budget scales with round length
// and is set AT that resting rate (0.25/s = 15/min): blinking normally
// leaves you right at the edge, which is what makes it a game rather than a
// formality. 0 means any blink ends the round; null means no limit.
export const BLINK_BUDGET_PER_SECOND = 0.25;
export const BLINK_BUDGET_MIN = 2;

// Breathing is an opt-in game detector. It is useful for the C.U.I.D.A. demo
// but too hard to suppress for a public presentation, so the game leaves it
// informational by default.
export const BREATHING_RAPID_RPM = 24;

// Rapid breathing must hold this long before it counts, since the rate comes
// from a 20s window and should not flip the result on one noisy estimate.
export const BREATHING_RAPID_HOLD_MS = 2000;


// ─── Breathing PRESENCE (the game) ──────────────────────────────────────────
// Rate needs ~20s of signal; presence needs about one cycle, which is what a
// five-second round can afford. Measured as peak-to-peak amplitude of the
// de-trended shoulder line, in units of shoulder width.
export const BREATHING_FAST_WINDOW_FRAMES = 120;   // ~4s at 30fps

// Breathing lifts the shoulder line by roughly 1% of shoulder width. The
// threshold sits below that but well above the smoothed detector noise.
export const BREATHING_AMPLITUDE_THRESHOLD = 0.006;


// ─── Post-game replay ──────────────────────────────────────────────────────
// Rolling window of frames kept during PLAYING so the loss replay can show
// the moments leading into the detection.
export const REPLAY_BUFFER_MS = 3500;
export const REPLAY_PLAYBACK_RATE = 0.6; // slow-motion factor for legibility
export const REPLAY_HOLD_MS = 1600;      // pause on the final frame before looping
export const REPLAY_ZOOM_SCALE = 1.9;    // push-in on the telltale zone during the hold

export const REPLAY_ZONE_COLOR = '#ff6b6b';
export const REPLAY_GHOST_COLOR = 'rgba(232, 228, 223, 0.4)';

// Video thumbnail captured alongside landmarks for the replay background.
// Width is fixed and height follows the camera's aspect ratio. It lives in
// an in-memory canvas for this tab only — never stored or sent anywhere.
export const REPLAY_FRAME_WIDTH = 360;
export const REPLAY_FRAME_CAPTURE_EVERY_N_FRAMES = 2; // ~15fps at a 30fps camera

// Pose landmarks the replay halo points at when the detection came from the
// face rather than the body: eyes for a blink, mouth for a gesture,
// shoulders for breathing.
export const REPLAY_SIGNAL_FOCUS = {
  blink: [2, 5],
  gesture: [9, 10],
  breathing: [11, 12],
};

// Lost-result copy tiers, keyed by the fraction of freezeSeconds survived (0..1).
// `max` is the upper bound of the tier (inclusive); the list is checked in order.
// Verdict on the defeat screen, tiered by how much of the freeze was
// survived. Each participant plays once, so these say how it went and
// nothing more — no tier invites another attempt.
// Sentinel `infractionReason` for a round the player ended themselves (the
// "Salir" button), so the result screen can tell it apart from an actual
// detection — abandoning is not a failure and gets neutral copy, no replay.
export const ABANDONED_REASON = '__abandoned__';

export const LOST_MESSAGE_TIERS = [
  { max: 0.15, title: 'Te detectamos enseguida' },
  { max: 0.45, title: 'Te detectamos rápido' },
  { max: 0.75, title: 'Aguantaste bastante' },
  { max: 1.01, title: 'Estuviste a un paso' },
];

// ─── "Simón Dice" — modo alternativo ────────────────────────────────────────
// En vez de suprimir señales sutiles, el jugador cumple posturas grandes e
// inequívocas. Es mucho más tolerante a la distancia, la luz y el movimiento
// de fondo de un stand de feria, que es justo lo que rompía al modo "quedate
// quieto" en esas condiciones.
export const SIMON_PRESETS = {
  short: {
    label: 'Corta',
    commandCount: 7,
    commandSeconds: 4,
    description: '7 comandos de 4 s — partida rápida para una fila larga.',
  },
  long: {
    label: 'Larga',
    commandCount: 11,
    commandSeconds: 3,
    description: '11 comandos de 3 s — partida más desafiante.',
  },
};
export const DEFAULT_SIMON_PRESET = 'short';

// Una postura debe sostenerse esta cantidad de cuadros consecutivos para
// contar como cumplida — mismo mecanismo anti-parpadeo que BREACH_CONFIRM_FRAMES,
// pero más corto porque aquí sostener la postura es el objetivo, no un
// accidente a filtrar.
export const SIMON_POSE_CONFIRM_FRAMES = 3;

// Puntaje: fijo por cumplir + bono de velocidad escalonado (no proporcional),
// para que el valor de "ser rápido" se entienda de un vistazo desde el stand.
export const SIMON_BASE_POINTS = 10;
export const SIMON_SPEED_BONUS_TIERS = [
  { maxSeconds: 1.5, bonus: 5 },
  { maxSeconds: 3, bonus: 2 },
];

// Umbrales de premio — ajustables en vivo desde el admin, no fijos en build,
// porque cuántos stickers/lapiceras hay en el stand varía por evento.
export const DEFAULT_STICKER_THRESHOLD = 50;
export const DEFAULT_PEN_THRESHOLD = 90;
export const MIN_REWARD_THRESHOLD = 10;
export const MAX_REWARD_THRESHOLD = 300;

// Márgenes de clasificación de pose (unidades de calculateBodyScale, igual
// normalización que usa el detector de movimiento) — cuánto debe despegarse
// una muñeca de un landmark de referencia para contar como "arriba"/"tocando".
// Valores generosos a propósito: el encuadre típico (medio cuerpo, cámara a
// la altura del pecho) deja mucho menos recorrido vertical entre hombro y
// muñeca que lo que un margen "seguro" sugeriría a ojo — con 0.35 ninguna
// postura llegaba a confirmarse nunca. Pensados para calibrarse mirando el
// panel de diagnóstico (tecla D) frente a la cámara real del stand.
export const SIMON_ARMS_UP_MARGIN = 0.12;
export const SIMON_ARMS_DOWN_MARGIN = 0.15;
export const SIMON_TOUCH_MARGIN = 0.18;

// Etiqueta ambiental que acompaña a quien pasa frente al stand.
// Una observación queda visible AMBIENT_OBS_RELEASE_MS después de dejar de
// detectarse, para que no parpadee con cada cuadro dudoso.
export const AMBIENT_OBS_RELEASE_MS = 700;
// Si no hay nadie en cuadro durante este tiempo, la próxima persona que
// aparezca recibe un número nuevo ("PERSONA #13").
export const AMBIENT_PERSON_GONE_MS = 2000;
// Velocidad horizontal del cuerpo (ancho de cuadro por segundo), medida sobre
// AMBIENT_MOTION_WINDOW_MS: por encima de WALK cuenta como caminando, por
// debajo de STILL como quieto; entre las dos se mantiene el último estado.
export const AMBIENT_MOTION_WINDOW_MS = 500;
export const AMBIENT_WALK_SPEED = 0.15;
export const AMBIENT_STILL_SPEED = 0.05;

// Blendshape thresholds (0..1) for the idle-screen's ambient signals — a
// resting face sits well below each of these, a deliberate expression well
// above, so no per-person calibration is needed the way the game does it.
export const AMBIENT_SMILE_THRESHOLD = 0.5;
export const AMBIENT_MOUTH_OPEN_THRESHOLD = 0.45;
export const AMBIENT_EYEBROWS_UP_THRESHOLD = 0.4;
// A wink needs one eye clearly closed (above) while the other stays clearly
// open (below) — otherwise an ordinary blink, which closes both evenly,
// would read as one.
export const AMBIENT_WINK_CLOSED_THRESHOLD = 0.6;
export const AMBIENT_WINK_OPEN_THRESHOLD = 0.25;

// Saludo con la mano: muñeca por encima del hombro yendo y viniendo de lado
// a lado. Cada vaivén tiene que recorrer al menos AMBIENT_WAVE_MIN_SWING
// (en unidades de calculateBodyScale) para contar — filtra el temblor del
// tracking — y hacen falta AMBIENT_WAVE_MIN_REVERSALS cambios de dirección
// dentro de AMBIENT_WAVE_WINDOW_MS para distinguir un saludo de una mano que
// solo se levantó una vez.
export const AMBIENT_WAVE_MIN_SWING = 0.12;
export const AMBIENT_WAVE_MIN_REVERSALS = 2;
export const AMBIENT_WAVE_WINDOW_MS = 1500;

// ─── Leaderboard ─────────────────────────────────────────────────────────
export const LEADERBOARD_SIZE = 5;
export const LEADERBOARD_NAME_MAX_LENGTH = 12;

// ─── Video / Camera Sources ──────────────────────────────────────────────
export const VIDEO_SOURCE_TYPES = ['webcam', 'http', 'file'];
export const DEFAULT_VIDEO_SOURCE_TYPE = 'webcam';
export const HTTP_STREAM_MODES = ['auto', 'mjpeg', 'video', 'snapshot'];
export const DEFAULT_HTTP_STREAM_MODE = 'auto';
