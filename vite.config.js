import fs from 'node:fs'
import path from 'node:path'
import http from 'node:http'
import https from 'node:https'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

const REMOTE_POSE_MODELS = {
  '/models/pose_landmarker_full.task':
    'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/latest/pose_landmarker_full.task',
  '/models/pose_landmarker_heavy.task':
    'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_heavy/float16/latest/pose_landmarker_heavy.task',
}

/**
 * Downloads and caches `pose_landmarker_full.task` or `pose_landmarker_heavy.task`
 * into `public/models/` on first use when selected from #admin, so subsequent
 * runs work 100% offline. If offline, responds with 404 so the client falls
 * back to the bundled `pose_landmarker_lite.task`.
 */
function modelAutoCacheMiddleware(req, res, next) {
  const urlPath = req.url?.split('?')[0]
  const remoteUrl = urlPath ? REMOTE_POSE_MODELS[urlPath] : null
  if (!remoteUrl) {
    next()
    return
  }

  const localFile = path.resolve(process.cwd(), 'public', urlPath.slice(1))
  if (fs.existsSync(localFile) && fs.statSync(localFile).size > 1024) {
    next()
    return
  }

  https
    .get(remoteUrl, (upstream) => {
      if (upstream.statusCode !== 200) {
        res.writeHead(404)
        res.end('Model not available offline')
        upstream.resume()
        return
      }
      const chunks = []
      upstream.on('data', (chunk) => chunks.push(chunk))
      upstream.on('end', () => {
        const buffer = Buffer.concat(chunks)
        try {
          fs.mkdirSync(path.dirname(localFile), { recursive: true })
          fs.writeFileSync(localFile, buffer)
        } catch {
          // Ignore disk write failure; still serve buffer in-memory
        }
        res.writeHead(200, {
          'Content-Type': 'application/octet-stream',
          'Content-Length': buffer.length,
        })
        res.end(buffer)
      })
    })
    .on('error', () => {
      res.writeHead(404)
      res.end('Offline: model not cached locally')
    })
}

/**
 * Local proxy middleware (/__camera_proxy?url=...) so the browser can connect
 * to LAN HTTP cameras (MJPEG streams like Android IP Webcam, DroidCam,
 * ESP32-CAM, JPEG snapshots, or HTTP video files) without CORS blocks or
 * WebGL/Canvas tainting in MediaPipe.
 */
function cameraProxyMiddleware(req, res, next) {
  if (!req.url || !req.url.startsWith('/__camera_proxy')) {
    next()
    return
  }

  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
      'Access-Control-Allow-Headers': '*',
    })
    res.end()
    return
  }

  let targetUrl
  try {
    const parsedReq = new URL(req.url, 'http://localhost')
    const rawTarget = parsedReq.searchParams.get('url')
    if (!rawTarget) {
      res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' })
      res.end('Missing url parameter')
      return
    }
    targetUrl = new URL(rawTarget)
    if (targetUrl.protocol !== 'http:' && targetUrl.protocol !== 'https:') {
      res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' })
      res.end('Only http: and https: URLs are supported')
      return
    }
  } catch {
    res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' })
    res.end('Invalid target URL')
    return
  }

  const client = targetUrl.protocol === 'https:' ? https : http
  const forwardHeaders = {
    'User-Agent': req.headers['user-agent'] || 'CUIDA-FreezeGame-CameraProxy/1.0',
    Accept: req.headers['accept'] || '*/*',
  }
  if (req.headers['range']) {
    forwardHeaders['Range'] = req.headers['range']
  }

  const proxyReq = client.request(
    targetUrl,
    {
      method: req.method === 'HEAD' ? 'HEAD' : 'GET',
      headers: forwardHeaders,
      rejectUnauthorized: false,
    },
    (proxyRes) => {
      const headers = { ...proxyRes.headers }
      headers['access-control-allow-origin'] = '*'
      headers['access-control-expose-headers'] = '*'
      headers['cache-control'] = 'no-store, no-cache, must-revalidate, proxy-revalidate'
      delete headers['content-security-policy']
      delete headers['x-frame-options']

      res.writeHead(proxyRes.statusCode || 200, headers)
      proxyRes.pipe(res)
    }
  )

  proxyReq.on('error', (err) => {
    if (!res.headersSent) {
      res.writeHead(502, {
        'Content-Type': 'text/plain; charset=utf-8',
        'Access-Control-Allow-Origin': '*',
      })
    }
    res.end(`Camera proxy error: ${err.message}`)
  })

  req.on('close', () => {
    proxyReq.destroy()
  })

  proxyReq.end()
}

  function cuidaServerPlugin() {
    return {
      name: 'cuida-server-plugin',
      configureServer(server) {
        server.middlewares.use(modelAutoCacheMiddleware)
        server.middlewares.use(cameraProxyMiddleware)
      },
      configurePreviewServer(server) {
        server.middlewares.use(modelAutoCacheMiddleware)
        server.middlewares.use(cameraProxyMiddleware)
      },
    }
  }

  // https://vite.dev/config/
  export default defineConfig({
    plugins: [react(), cuidaServerPlugin()],
  })
