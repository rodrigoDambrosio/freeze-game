# 🎮 C.U.I.D.A. — Freeze Game (Estatua Demo)

Módulo demostrativo autosuficiente e interactivo de **C.U.I.D.A.** diseñado para presentaciones, ferias y stands de exposición. Desafía al usuario a pararse frente a la cámara y quedarse completamente congelado durante una cantidad determinada de segundos.

El juego usa **las mismas señales que un sistema de monitoreo real**: postura, micromovimiento, gestos faciales, parpadeo y respiración. Ganar significa que ninguna de ellas detectó movimiento voluntario — y el panel lateral muestra, mientras tanto, que el sistema sigue viendo señales de vida. Ese es el punto de la demo: la misma visión que juzga el juego es la que, aplicada a monitoreo, distingue a una persona en reposo de una inmóvil o sin respuesta.

---

## 🌟 Qué detecta

Cinco señales corren en paralelo sobre el mismo video:

| Señal | Modelo | Rol en el juego |
|---|---|---|
| **Movimiento corporal** | Pose Landmarker | Infracción |
| **Desvío de postura** | Pose Landmarker | Infracción |
| **Gestos faciales** | Face Landmarker (blendshapes) | Infracción (configurable) |
| **Parpadeo** | Face Landmarker (blendshapes) | Se cuenta y se muestra; **no** penaliza por defecto |
| **Respiración** | Pose Landmarker (periodicidad) | Se muestra; nunca penaliza |

El parpadeo no penaliza porque es involuntario: penalizarlo haría el juego imposible de ganar. Se cuenta y se exhibe justamente para mostrar que el sistema lo ve.

---

## 🔬 Cómo funciona la detección

### Movimiento corporal

El detector tiembla aunque la persona esté perfectamente quieta, y con encuadres cerrados inventa landmarks que nunca vio. Cuatro defensas, en orden:

1. **Suavizado EMA adaptativo** — amortigua el jitter pequeño, deja pasar el movimiento real.
2. **Mediana por zona** — con cuatro puntos por zona, un punto malo no arrastra el promedio.
3. **Calibración de estabilidad** — durante los primeros 10 cuadros mide cuánto se mueve cada landmark por su cuenta y descarta los que no se quedan quietos respecto al resto del cuerpo. Así se auto-ajusta a cualquier encuadre, en vez de depender de umbrales fijos.
4. **Confirmación temporal** — una infracción debe sostenerse 4 cuadros; la pose puede perderse 800 ms antes de contar como que la persona salió del encuadre.

La escala corporal se normaliza por ancho de hombros, con respaldo en ancho de cabeza para primeros planos, de modo que el mismo movimiento físico puntúa igual de cerca que de lejos.

### Gestos faciales

Misma lógica de ancla que el cuerpo, pero sobre los blendshapes expresivos (mandíbula, cejas, boca, mejillas, nariz). Durante la calibración aprende el valor de reposo de cada uno y su oscilación natural, y resta ese piso: una cara neutra no registra gesto aunque sus blendshapes no estén en cero.

### Respiración

Mueve los hombros uno o dos milímetros — muy por debajo del ruido, así que medirla por amplitud es imposible. Pero **se repite**: se detecta por autocorrelación normalizada en la banda 8–30 rpm sobre una ventana de 20 s, con filtro paso-bajo previo. Se toma el lag más corto que llega al 85 % del pico máximo, porque la autocorrelación también pica en los múltiplos del período y el pico más alto suele caer en dos respiraciones en vez de una (lo que reportaría la mitad de la frecuencia real).

---

## 📴 Funciona sin internet

Todo se sirve local: ambos modelos (`public/models/`), el runtime WASM (bundleado desde `node_modules`) y la tipografía Outfit (`public/fonts/`). No hay CDN ni Google Fonts.

`src/lib/offlineGuard.js` además bloquea la telemetría que la librería de MediaPipe envía a `odml.pa.googleapis.com`, que no tiene opción pública para desactivarse. Sin red solo daría timeout, pero esta demo procesa video de personas y un sistema de monitoreo no debería reportar su uso hacia afuera.

Para verificarlo: `npm run build`, servir `dist/` y comprobar que ningún recurso sale del origen.

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
2. La persona se ubica frente a la cámara; el sistema la encuadra y marca **"¡Listo!"**.
3. El administrador presiona **"Empezar"**. Ahí se ancla la postura y la expresión de referencia.
4. Durante la cuenta regresiva, el panel lateral muestra las cinco señales en vivo.
5. Al terminar, la pantalla de resultado resume qué detectó el sistema: parpadeos, respiración y estado vital.

### Atajos

- **D** — panel de diagnóstico: score por zona contra su umbral, escala corporal detectada y qué landmarks se descartaron por inestables. Útil para entender un falso positivo.

### Panel de administrador

- Tiempo de congelamiento: 3 a 30 segundos.
- Sensibilidad: **Baja**, **Media** o **Alta** (afecta cuerpo y gestos).
- Penalizar gestos faciales (activado por defecto).
- Penalizar parpadeo (desactivado por defecto).

---

## ⚠️ Alcance

Es una demostración del enfoque de sensado, **no un dispositivo médico**. Una webcam no puede confirmar que alguien respira: la ausencia de una señal indica que la cámara no puede verla, lo que no equivale a su ausencia real. La detección de respiración además necesita que el torso entre en el encuadre — en primer plano las señales confiables son el parpadeo y los gestos faciales.
