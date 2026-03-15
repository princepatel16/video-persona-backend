import React from 'react';
import { AbsoluteFill, Img, Video, staticFile, interpolate, spring, useCurrentFrame, useVideoConfig } from 'remotion';
import { z } from 'zod';

export const lastSlideSchema = z.object({
    doctorName: z.string(),
    photoUrl: z.string(),
    theme: z.string(),
    imageX: z.number(),
    imageY: z.number(),
    backgroundVideoPath: z.string().optional(),
});

type LastSlideProps = z.infer<typeof lastSlideSchema>;

export const LastSlide: React.FC<LastSlideProps> = ({ doctorName, photoUrl, theme, imageX, imageY, backgroundVideoPath }) => {
    const frame = useCurrentFrame();
    const { fps } = useVideoConfig();

    // Animate photo scaling in
    const scale = spring({
        fps,
        frame,
        config: {
            damping: 12,
        },
    });

    // Fade in text
    const opacity = interpolate(frame, [15, 30], [0, 1], {
        extrapolateLeft: 'clamp',
        extrapolateRight: 'clamp',
    });

    const backgroundColor = theme.includes('womens_day') ? '#f3e5f5' : '#ffffff';

    return (
        <AbsoluteFill style={{ backgroundColor }}>
            {/* Render the background video directly via staticFile if provided from Node */}
            {backgroundVideoPath && (
                <Video 
                    src={staticFile(backgroundVideoPath)} 
                    style={{ position: 'absolute', width: '100%', height: '100%', objectFit: 'cover' }}
                />
            )}
            
            {/* The exact X / Y position passed from the frontend */}
            <div 
                style={{ 
                    position: 'absolute', 
                    left: `${imageX}px`, 
                    top: `${imageY}px`,
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    // The original FFmpeg overlay point is top-left, but we center the content on that point to match how it scaled. 
                    // However, we should just follow strictly what the frontend requested:
                }}
            >
                <div style={{ transform: `scale(${scale})`, marginBottom: '20px' }}>
                    <Img
                        src={staticFile(photoUrl)}
                        style={{
                            width: '400px', // Matches your frontend circle size roughly, adjust if needed
                            height: '400px',
                            borderRadius: '50%',
                            objectFit: 'cover',
                            boxShadow: '0px 10px 30px rgba(0,0,0,0.2)',
                        }}
                    />
                </div>

                <div
                    style={{
                        opacity,
                        fontSize: '60px',
                        fontWeight: 'bold',
                        color: '#333',
                        fontFamily: 'sans-serif',
                        textAlign: 'center',
                        textTransform: 'uppercase'
                    }}
                >
                    {doctorName}
                </div>
            </div>
        </AbsoluteFill>
    );
};
