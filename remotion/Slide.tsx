import React from 'react';
import { AbsoluteFill, Img, Video, staticFile, interpolate, spring, useCurrentFrame, useVideoConfig } from 'remotion';
import { z } from 'zod';

export const lastSlideSchema = z.object({
    doctorName: z.string(),
    photoUrl: z.string(),
    nameImageUrl: z.string().optional(),
    theme: z.string(),
    imageX: z.number(),
    imageY: z.number(),
    backgroundVideoPath: z.string().optional(),
});

type LastSlideProps = z.infer<typeof lastSlideSchema>;

export const LastSlide: React.FC<LastSlideProps> = ({ 
    doctorName, 
    photoUrl, 
    nameImageUrl, 
    theme, 
    imageX, 
    imageY, 
    backgroundVideoPath 
}) => {
    const frame = useCurrentFrame();
    const { fps } = useVideoConfig();

    // 1. Pop-up animation for photo
    const photoScale = spring({
        fps,
        frame,
        config: { damping: 12 },
    });

    // 2. Fade-in animation for name text (starts slightly later)
    const textOpacity = interpolate(frame, [20, 40], [0, 1], {
        extrapolateLeft: 'clamp',
        extrapolateRight: 'clamp',
    });

    const backgroundColor = theme.includes('womens_day') ? '#f3e5f5' : '#ffffff';

    return (
        <AbsoluteFill style={{ backgroundColor }}>
            {backgroundVideoPath && (
                <Video 
                    src={staticFile(backgroundVideoPath)} 
                    style={{ position: 'absolute', width: '100%', height: '100%', objectFit: 'cover' }}
                    muted={false}
                    volume={1}
                />
            )}
            
            <div style={{ position: 'absolute', left: `${imageX}px`, top: `${imageY}px`, display: 'flex', alignItems: 'center' }}>
                {/* 1. Photo (Animated with Scale) */}
                <div style={{ transform: `scale(${photoScale})` }}>
                    <Img
                        src={staticFile(photoUrl)}
                        style={{ maxWidth: '100%' }}
                        onError={(e) => console.error("Photo Load Error:", photoUrl)}
                    />
                </div>

                {/* 2. Text (Animated with Fade) */}
                {nameImageUrl && (
                    <div style={{ opacity: textOpacity, marginLeft: '10px' }}>
                        <Img
                            src={staticFile(nameImageUrl)}
                            style={{ maxWidth: '100%' }}
                            onError={(e) => console.error("Name Image Load Error:", nameImageUrl)}
                        />
                    </div>
                )}
            </div>
        </AbsoluteFill>
    );
};
