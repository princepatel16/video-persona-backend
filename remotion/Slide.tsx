import React from 'react';
import { AbsoluteFill, Img, interpolate, spring, useCurrentFrame, useVideoConfig } from 'remotion';
import { z } from 'zod';

export const lastSlideSchema = z.object({
    doctorName: z.string(),
    photoUrl: z.string(),
    theme: z.string(),
});

type LastSlideProps = z.infer<typeof lastSlideSchema>;

export const LastSlide: React.FC<LastSlideProps> = ({ doctorName, photoUrl, theme }) => {
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

    // We can map `theme` to specific background colors or images
    const backgroundColor = theme.includes('womens_day') ? '#f3e5f5' : '#ffffff';

    return (
        <AbsoluteFill style={{ backgroundColor, alignItems: 'center', justifyContent: 'center' }}>
            {/* Background Image could go here if needed, or keeping it simple for PoC */}
            
            <div style={{ transform: `scale(${scale})`, marginBottom: '100px' }}>
                <Img
                    src={photoUrl}
                    style={{
                        width: '500px',
                        height: '500px',
                        borderRadius: '50%',
                        objectFit: 'cover',
                        boxShadow: '0px 10px 30px rgba(0,0,0,0.2)',
                    }}
                />
            </div>

            <div
                style={{
                    opacity,
                    fontSize: '80px',
                    fontWeight: 'bold',
                    color: '#333',
                    fontFamily: 'sans-serif',
                }}
            >
                {doctorName}
            </div>
        </AbsoluteFill>
    );
};
