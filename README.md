# 🎮 C.U.I.D.A. — El desafío

Módulo demostrativo autosuficiente de **C.U.I.D.A.** para presentaciones, ferias y stands.

**El objetivo no es quedarse quieto: es evitar que el sistema detecte que estás vivo.** Durante 20 segundos, C.U.I.D.A. busca cualquier señal de vida — movimiento, gestos, parpadeo, respiración. Si encuentra una sola, te detectó. Si no encuentra ninguna, el jugador se lleva el premio.

La configuración inicial busca que sea difícil pero posible: los gestos se penalizan, se toleran tres parpadeos y la respiración se muestra como señal informativa sin hacer perder la partida. El administrador puede endurecerla desde la pantalla de configuración, que se abre aparte para que los participantes no la vean.

---

## 🔍 Los detectores

Cinco detectores corren en paralelo sobre el mismo video. Cada uno que se active delata al jugador.

| Detector | Modelo | Qué lo delata |
|---|---|---|
| **Movimiento corporal** | Pose Landmarker | Desplazamiento o desvío de la postura inicial |
| **Micromovimiento** | Pose + Face | La cabeza nunca queda del todo inmóvil |
| **Gesto facial** | Face Landmarker (blendshapes) | Sonreír, abrir la boca, mover las cejas |
| **Parpadeo** | Face Landmarker (blendshapes) | Tolerancia configurable, por defecto ninguno |
| **Respiración** | Pose Landmarker (amplitud + periodicidad) | El pecho se mueve |

El panel lateral los muestra en vivo: verde significa que ese detector todavía no te encontró, rojo que te delató. La respiración no penaliza por defecto porque una partida que exige contenerla no es un desafío razonable para una presentación.

---

## 🔬 Cómo funciona la detección

### Respiración — dos detectores, no uno

Es la señal más difícil de suprimir y la que decide casi todas las partidas. Se mide de dos formas complementarias:

- **Presencia** (ventana de 4 s): amplitud de la oscilación del torso, tras quitar el ruido con una media móvil y la deriva postural con una recta de mínimos cuadrados. Responde en aproximadamente un ciclo respiratorio.
- **Frecuencia** (ventana de 20 s): autocorrelación normalizada en la banda 8–40 rpm. Da el número en respiraciones por minuto.

La amplitud se deriva de la desviación estándar del residuo, no de su rango pico a pico: ambas describen igual a una sinusoide, pero el pico a pico del ruido crece con el largo de la ventana y leería una ventana más larga como una respiración más grande.

Calibración medida contra ruido del detector (`jitter` = ruido por cuadro en la posición de los hombros):

| movimiento de hombros | jitter 0.0004 | jitter 0.0008 | jitter 0.0015 |
|---|---|---|---|
| **sin respirar (apnea)** | **0 %** | **0 %** | **0 %** |
| 0.6 ‰ de la imagen | 0 % | 0 % | 10 % |
| 1.0 ‰ | 38 % | 50 % | 53 % |
| 1.5 ‰ | 93 % | 90 % | 95 % |
| 2.5 ‰ | 100 % | 100 % | 100 % |

La primera fila son falsos positivos: nadie pierde sin respirar. El resto es la tasa de detección por ventana — y como en 20 s se evalúan varias ventanas, respirar con normalidad hace prácticamente imposible ganar. Escaparse exige respiración abdominal muy controlada, con menos de medio milímetro de movimiento en los hombros.

### Normalizar por una escala que también tiene ruido

Dos detectores dividían una posición absoluta por una escala medida cuadro a cuadro (ancho de cabeza, ancho de hombros). Como la nariz está a unas 2,5 anchos de cabeza del origen, una escala que oscile un 0,3 % mueve ese cociente más que el umbral: el detector leía su propio ruido de escala como movimiento, y nadie podía quedarse lo bastante quieto. Ambas escalas se suavizan ahora con un EMA lento antes de dividir.

### Movimiento corporal

El detector tiembla aunque la persona esté quieta, y con encuadres cerrados inventa landmarks que nunca vio. Cuatro defensas:

1. **Suavizado EMA adaptativo** — amortigua el jitter, deja pasar el movimiento real.
2. **Mediana por zona** — con cuatro puntos por zona, uno malo no arrastra el promedio.
3. **Calibración de estabilidad** — en los primeros 10 cuadros mide cuánto se mueve cada landmark por su cuenta y descarta los que no se quedan quietos respecto al resto del cuerpo.
4. **Confirmación temporal** — una detección debe sostenerse 4 cuadros.

### Gestos faciales

Ancla la expresión al empezar la ronda y mide la desviación sobre los blendshapes expresivos. Durante la calibración aprende el valor de reposo de cada uno y su oscilación natural, y resta ese piso: una cara neutra marca 0.028 contra un umbral de 0.18.

---

## 📴 Funciona sin internet

Todo local: ambos modelos (`public/models/`), el runtime WASM (bundleado desde `node_modules`) y la tipografía Outfit (`public/fonts/`). Sin CDN ni Google Fonts.

`src/lib/offlineGuard.js` bloquea además la telemetría que MediaPipe envía a `odml.pa.googleapis.com`, que no tiene opción pública para desactivarse. Sin red solo daría timeout, pero esta demo procesa video de personas y un sistema de monitoreo no debería reportar su uso hacia afuera.

---

## 🚀 Cómo ejecutar

```bash
npm install
npm run dev
```

- `npm run dev` — servidor de desarrollo Vite con HMR.
- `npm run build` — bundle de producción en `dist/`.
- `npm run lint` — análisis estático con Oxlint.
- `npm run preview` — previsualiza el build.

---

## 🕹️ Dinámica

1. **"Activar cámara"** y permitir el acceso a la webcam.
2. El sistema encuentra a la persona y marca que está listo.
3. El administrador presiona **"Empezar"**. Ahí se anclan la postura y la expresión de referencia.
4. Durante 20 segundos el jugador intenta no ser detectado. El panel muestra cuántos detectores lo tienen.
5. Al terminar, la pantalla de resultado nombra **qué detector lo delató** y muestra una **repetición en cámara lenta** de los últimos segundos: el video de la cámara con el esqueleto encima, la postura inicial como referencia y un halo sobre lo que lo delató (la articulación que se movió, los ojos, la boca o los hombros). El video vive sólo en memoria de la pestaña y nunca se guarda ni se envía.

### Atajos

- **D** — panel de diagnóstico: score por zona contra su umbral, escala corporal y qué landmarks se descartaron por inestables.

### Pantalla de configuración

Se abre en otra pestaña o ventana con `http://localhost:5173/#admin` (no hay ningún botón en la pantalla de juego). Los cambios se aplican en vivo a la pantalla de juego a través de `localStorage`, sin servidor. Muestra si la pantalla de juego está conectada, en qué estado está y la lectura de movimiento en vivo contra el umbral.

- Duración: 20 a 60 segundos. El mínimo no es una preferencia: la frecuencia respiratoria necesita unos quince segundos de señal para poder medirse.
- Sensibilidad: **Baja**, **Media** o **Alta** (afecta cuerpo y gestos).
- Detectar gestos faciales / parpadeo / respiración, por separado.
- Parpadeos tolerados: Ninguno, 1, 3 o 5 (por defecto, 3).

El detector de respiración está desactivado por defecto: puede activarse para una demostración técnica más estricta, pero no se recomienda para una partida abierta al público.

---

## ⚠️ Alcance

Es una demostración del enfoque de sensado, **no un dispositivo médico**. Una webcam no puede confirmar que alguien respira: la ausencia de una señal indica que la cámara no puede verla, lo que no equivale a su ausencia real.

Sobre el juego en sí: ganar requiere en la práctica contener la respiración unos 20 segundos. Para la mayoría de la gente eso es inofensivo, pero si el público del stand incluye adultos mayores conviene presentarlo como un desafío opcional, o correrlo con el detector de respiración apagado.
