const { bundle } = require('@remotion/bundler');
const { renderMedia, selectComposition } = require('@remotion/renderer');
const path = require('path');

async function renderLastSlide({ introVideoPath, doctorName, photoUrl, nameImageUrl, theme, imageX, imageY, backgroundVideoPath, outputPath }) {
    console.log('--- REMOTION UNIFIED RENDER START ---');
    console.log('Parameters:', { introVideoPath, doctorName, photoUrl, nameImageUrl, theme, imageX, imageY, backgroundVideoPath, outputPath });
    
    try {
        console.log('Step 1: Starting Remotion Bundling...');
        const bundledData = await bundle({
            entryPoint: path.resolve(__dirname, 'Root.tsx'),
            publicDir: path.resolve(__dirname, '..', 'public'),
        });

        console.log('Step 2: Selecting Composition...');
        const composition = await selectComposition({
            serveUrl: bundledData,
            id: 'UnifiedVideo',
            inputProps: {
                introVideoPath,
                lastSlideProps: {
                    doctorName,
                    photoUrl,
                    nameImageUrl,
                    theme,
                    imageX,
                    imageY,
                    backgroundVideoPath,
                }
            },
            browserLaunchTimeout: 60000,
        });

    console.log('Step 3: Rendering Unified Media...', outputPath);
    await renderMedia({
        composition,
        serveUrl: bundledData,
        codec: 'h264',
        audioCodec: 'aac',
        outputLocation: outputPath,
        inputProps: {
            introVideoPath,
            lastSlideProps: {
                doctorName,
                photoUrl,
                nameImageUrl,
                theme,
                imageX,
                imageY,
                backgroundVideoPath,
            }
        },
        verbose: true,
        concurrency: 1,
    });

    console.log('--- REMOTION UNIFIED RENDER COMPLETE ---');
    return outputPath;
} catch (error) {
    console.error('!!! REMOTION RENDER ERROR !!!');
    throw error;
}
}

module.exports = { renderLastSlide };
