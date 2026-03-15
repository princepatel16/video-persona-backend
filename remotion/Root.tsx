import React from 'react';
import { Composition, registerRoot, Series, Video, staticFile, AbsoluteFill } from 'remotion';
import { LastSlide, lastSlideSchema } from './Slide';
import { z } from 'zod';

const unifiedVideoSchema = z.object({
    introVideoPath: z.string(),
    lastSlideProps: lastSlideSchema,
});

const UnifiedVideo: React.FC<z.infer<typeof unifiedVideoSchema>> = ({ introVideoPath, lastSlideProps }) => {
    return (
        <Series>
            {/* 1. Intro Video Segment (41.3s / 1239 frames) */}
            <Series.Sequence durationInFrames={1239}>
                <AbsoluteFill>
                    <Video src={staticFile(introVideoPath)} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                </AbsoluteFill>
            </Series.Sequence>
            
            {/* 2. Animated Last Slide (5s / 150 frames) */}
            <Series.Sequence durationInFrames={150}>
                <LastSlide {...lastSlideProps} />
            </Series.Sequence>
        </Series>
    );
};

export const RemotionRoot: React.FC = () => {
    return (
        <>
            <Composition
                id="UnifiedVideo"
                component={UnifiedVideo}
                durationInFrames={1389} // 1239 + 150
                fps={30}
                width={1080}
                height={1920}
                schema={unifiedVideoSchema}
                defaultProps={{
                    introVideoPath: 'videos/Woman day video static video Female.mp4',
                    lastSlideProps: {
                        doctorName: 'Dr. Jane Doe',
                        photoUrl: 'images/placeholder.png',
                        nameImageUrl: '',
                        theme: 'womens_day',
                        imageX: 38,
                        imageY: 137,
                        backgroundVideoPath: 'videos/Woman day video last slide.mp4',
                    }
                }}
            />
            {/* Keep the original for backward compatibility or direct access */}
            <Composition
                id="LastSlide"
                component={LastSlide}
                durationInFrames={150}
                fps={30}
                width={1080}
                height={1920}
                schema={lastSlideSchema}
                defaultProps={{
                    doctorName: 'Dr. Jane Doe',
                    photoUrl: 'images/placeholder.png',
                    nameImageUrl: '',
                    theme: 'womens_day',
                    imageX: 38,
                    imageY: 137,
                    backgroundVideoPath: 'videos/Woman day video last slide.mp4',
                }}
            />
        </>
    );
};

registerRoot(RemotionRoot);
