# Video Persona Backend

Backend server for the Video Persona application. Handles video processing and overlay generation using FFmpeg.

## Setup

### 1. Install Dependencies
```bash
cd backend
npm install
```

### 2. Start the Server
```bash
npm start
```

The server will start on port `3001`.

## Dependencies

- **express**: Web server framework
- **cors**: Enable CORS for frontend communication
- **multer**: Handle file uploads
- **fluent-ffmpeg**: FFmpeg wrapper for video processing
- **ffmpeg-static**: Bundled FFmpeg binary
- **sharp**: Image processing
- **dotenv**: Environment variables (if needed)

## Directory Structure

```
backend/
├── server.js           # Main server file
├── package.json        # Dependencies
├── public/
│   └── videos/         # Base video files
├── temp/               # Temporary processing files
└── uploads/            # Uploaded doctor images
```

## API Endpoints

### POST `/api/process-video-stream`
Processes video with doctor overlay. Returns Server-Sent Events (SSE) for progress updates.

**Request:**
- `doctorImage`: Image file (multipart/form-data)
- `doctorName`: Doctor's name (string)
- `overlayX`: X position (0-1, decimal)
- `overlayY`: Y position (0-1, decimal)

**Response:** SSE stream with progress events

### GET `/download/:filename`
Downloads the processed video and deletes it from server after download.

## Notes

- Videos are automatically deleted after download to save disk space
- Frontend should be running on a different port (e.g., 9002 or 3000)
- Make sure the base video file exists at `public/videos/hypertension_video english.mp4`
