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
            
            {/* The exact X / Y position passed from the frontend (top-left of the composite group) */}
            <div 
                style={{ 
                    position: 'absolute', 
                    left: `${imageX}px`, 
                    top: `${imageY}px`,
                    transform: `scale(${scale})`,
                    opacity, // Let the group fade in slightly as well
                    display: 'flex',
                    alignItems: 'center',
                }}
            >
                <Img
                    src={staticFile(photoUrl)}
                    style={{
                        // We don't set a fixed width/height here because the PNG is already correctly sized from the frontend canvas
                        maxWidth: '100%',
                    }}
                    onError={(e) => console.error("Overlay Load Error:", photoUrl)}
                />
            </div>
        </AbsoluteFill>
    );
};
