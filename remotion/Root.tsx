import React from 'react';
import { Composition, registerRoot } from 'remotion';
import { LastSlide, lastSlideSchema } from './Slide';

export const RemotionRoot: React.FC = () => {
    return (
        <>
            <Composition
                id="LastSlide"
                component={LastSlide}
                durationInFrames={150} // 5 seconds at 30fps
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
