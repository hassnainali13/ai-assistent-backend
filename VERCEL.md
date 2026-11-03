# Deploying the backend to Vercel

1. Import this repository into Vercel and set the project root to
   `ai-assistent-backend-main` (the folder containing `vercel.json`).
2. Keep the existing `vercel.json` configuration. Vercel will build
   `server.js` as a Node.js function; no separate build command is needed.
3. In **Project Settings → Environment Variables**, add:
   - `MONGODB_URI` — your MongoDB connection string
   - `GEMINI_API_KEY` — your Google Gemini API key
4. Deploy, then check `https://<your-domain>/api/health`.
5. In each frontend project’s Vercel settings, set `VITE_BACKEND_URL` for the
   portfolio frontend and `VITE_API_BASE_URL` for the separate admin frontend
   to the deployed backend URL, without a trailing slash. Redeploy each
   frontend after changing its environment variables.

The API keeps database connections warm between function requests and caps
JSON and uploaded-file requests at 4 MB to stay within Vercel's request-body
limits. Store larger images with an image-hosting service and send their URL
to `/api/panel-images` instead of uploading them as data URLs.
