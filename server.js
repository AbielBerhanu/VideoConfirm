const express = require('express');
const multer = require('multer');
const ffmpeg = require('fluent-ffmpeg');
const path = require('path');
const fs = require('fs');
const cors = require('cors');

const app = express();
const PORT = 5001; // Using a different port to avoid conflicts

// Create necessary directories
const uploadsDir = path.join(__dirname, 'uploads');
const chunksDir = path.join(__dirname, 'chunks');

if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir, { recursive: true });
}
if (!fs.existsSync(chunksDir)) {
    fs.mkdirSync(chunksDir, { recursive: true });
}

// Middleware
app.use(cors());
app.use('/chunks', express.static(chunksDir)); // Serve chunked files statically

// Configure multer for file uploads
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, uploadsDir);
    },
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, uniqueSuffix + path.extname(file.originalname));
    }
});
const upload = multer({ storage: storage });

// Endpoint to handle video upload and chunking
app.post('/api/upload', upload.single('video'), (req, res) => {
    if (!req.file) {
        return res.status(400).json({ error: 'No video file uploaded.' });
    }

    const chunkDuration = parseInt(req.body.chunkDuration, 10);
    if (!chunkDuration || chunkDuration <= 0) {
        return res.status(400).json({ error: 'Invalid chunk duration.' });
    }

    const videoPath = req.file.path;
    const outputDir = path.join(chunksDir, req.file.filename.replace('.', '_'));
    if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true });
    }

    ffmpeg(videoPath)
        .on('end', () => {
            console.log('Video has been chunked successfully.');
            // After chunking is complete, read the directory to get actual filenames
            fs.readdir(outputDir, (err, files) => {
                if (err) {
                    console.error("Could not list the directory.", err);
                    return res.status(500).json({ error: 'Failed to list video chunks.' });
                }

                // Sort files numerically based on the chunk number
                files.sort((a, b) => {
                    const numA = parseInt(a.match(/(\d+)/)[0], 10);
                    const numB = parseInt(b.match(/(\d+)/)[0], 10);
                    return numA - numB;
                });

                const chunkUrls = files.map(file => 
                    `http://localhost:${PORT}/chunks/${path.basename(outputDir)}/${file}`
                );

                res.json({ 
                    success: true, 
                    message: 'Video chunked successfully!',
                    chunkUrls: chunkUrls
                });

                // Clean up the original uploaded file after chunking
                fs.unlink(videoPath, (err) => {
                    if (err) console.error("Error deleting original upload:", err);
                });
            });
        })
        .on('error', (err) => {
            console.error('Error during chunking:', err.message);
            res.status(500).json({ error: 'Failed to chunk video.' });
        })
        .outputOptions([
            '-c copy', // Use -c copy for faster, direct stream copy without re-encoding
            '-f segment',
            `-segment_time ${chunkDuration}`,
            '-reset_timestamps 1'
        ])
        .output(path.join(outputDir, 'chunk-%03d.mp4'))
        .run();
});

app.listen(PORT, () => {
    console.log(`New simplified server running on http://localhost:${PORT}`);
    console.log('Make sure ffmpeg is installed on your system.');
});
