const { bundle } = require('@remotion/bundler');
const { renderMedia, selectComposition } = require('@remotion/renderer');
const path = require('path');

async function renderLastSlide({ doctorName, photoUrl, theme, imageX, imageY, backgroundVideoPath, outputPath }) {
    console.log('Starting Remotion Bundling...');
    // Bundle the composition
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

    console.log('Rendering Media...', outputPath);
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
    });

    console.log('Remotion Render Complete: ' + outputPath);
    return outputPath;
}

module.exports = { renderLastSlide };
