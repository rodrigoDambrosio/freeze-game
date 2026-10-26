# 🎮 C.U.I.D.A. — Freeze Game (Estatua Demo)

Módulo demostrativo autosuficiente e interactivo de **C.U.I.D.A.** diseñado para presentaciones, ferias y stands de exposición. Desafía al usuario a pararse frente a la cámara y quedarse completamente congelado durante una cantidad determinada de segundos sin moverse.

---

## 🌟 Características

- **100% Client-Side**: No requiere levantar backend en Python, base de datos ni Docker. Corre directamente en el navegador.
- **Detección de Postura con MediaPipe Pose**: Análogo directo al tracking de poses y personas por visión computacional de C.U.I.D.A. (YOLO-Pose / IdentityTracker).
- **Algoritmo de Detección de Movimiento Inteligente**:
  - Filtra solo puntos estructurales (hombros, codos, muñecas, caderas, rodillas, tobillos y nariz).
  - Ignora micro-movimientos faciales involuntarios (parpadeos, respiración leve, hablar).
  - Calcula la desviación euclidiana frame a frame y la compara contra un umbral de tolerancia.
  - Selección de la persona más prominente en escena (prioriza a quien está al frente en un stand concurrido).
- **Feedback Visual en Tiempo Real**:
  - Skeleton interactivo sobre el video en canvas overlay.
  - Bounding box con gradiente de color según el estado (Buscando, Listo, Jugando, Victoria, Infracción).
  - Indicador de nivel de movimiento vs. umbral de tolerancia.
- **Panel de Administrador Glassmorphism**:
  - Tiempo de congelamiento configurable (3 a 30 segundos).
  - Sensibilidad configurable: **Baja** (tolerante), **Media** (equilibrada) o **Alta** (estricta).
- **Estética & Branding C.U.I.D.A.**: Tipografía *Outfit*, slate dark theme, efectos de blur y partículas de victoria.

---

## 🚀 Cómo Ejecutar

Desde la raíz del repo:

```bash
npm install
npm run dev
```

Abre el navegador en la URL indicada (usualmente `http://localhost:5173`).

### Comandos disponibles

- `npm run dev`: Inicia el servidor de desarrollo Vite con Hot Module Replacement (HMR).
- `npm run build`: Genera el bundle de producción optimizado en `dist/`.
- `npm run lint`: Ejecuta el análisis estático de código con Oxlint.
- `npm run preview`: Previsualiza la versión construida de producción.

---

## 🕹️ Dinámica del Juego

1. **Inicio**: Presiona **"Activar Cámara"** y permite el acceso a la webcam.
2. **Posicionamiento**: La persona se ubica frente a la cámara. El sistema la encuadra y marca con un recuadro verde de "¡Listo!".
3. **Inicio del Desafío**: El administrador presiona **"▶ Empezar"**.
4. **Desafío**:
   - Corre la cuenta regresiva.
   - Si la persona mantiene la postura quieta hasta que el reloj llegue a 0: **¡Victoria! 🎉**.
   - Si se detecta un movimiento brusco antes de finalizar: **¡Derrota instantánea! ❌**.
5. **Reintento**: Un click en **"Jugar de nuevo"** resetea el desafío sin necesidad de recargar la página.
