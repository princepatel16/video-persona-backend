const { bundle } = require('@remotion/bundler');
const { renderMedia, selectComposition } = require('@remotion/renderer');
const path = require('path');

async function renderLastSlide({ doctorName, photoUrl, theme, imageX, imageY, backgroundVideoPath, outputPath }) {
    console.log('--- REMOTION RENDER START ---');
    console.log('Parameters:', { doctorName, photoUrl, theme, imageX, imageY, backgroundVideoPath, outputPath });
    
    try {
        console.log('Step 1: Starting Remotion Bundling...');
    const bundledData = await bundle({
        entryPoint: path.resolve(__dirname, 'Root.tsx'),
        // Optional: specify caching and other webpack options
    });

    console.log('Selecting Composition...');
    // Extract the composition to render
    const composition = await selectComposition({
        serveUrl: bundledData,
        id: 'LastSlide',
        inputProps: {
            doctorName,
            photoUrl,
            theme,
            imageX,
            imageY,
            backgroundVideoPath,
        },
    });

    console.log('Step 3: Rendering Media...', outputPath);
    // Render to MP4
    await renderMedia({
        composition,
        serveUrl: bundledData,
        codec: 'h264',
        outputLocation: outputPath,
        inputProps: {
            doctorName,
            photoUrl,
            theme,
            imageX,
            imageY,
            backgroundVideoPath,
        },
        verbose: true, // Enable more verbose logging from Remotion
    });

    console.log('--- REMOTION RENDER COMPLETE ---');
    console.log('Output Path:', outputPath);
    return outputPath;
} catch (error) {
    console.error('!!! REMOTION RENDER ERROR !!!');
    console.error('Error Name:', error.name);
    console.error('Error Message:', error.message);
    if (error.stack) console.error('Stack Trace:', error.stack);
    throw error;
}
}

module.exports = { renderLastSlide };
