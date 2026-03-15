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
                    photoUrl: 'https://upload.wikimedia.org/wikipedia/commons/a/a0/Andrzej_Person_Kancelaria_Senatu.jpg',
                    nameImageUrl: '',
                    theme: 'womens_day_female',
                    imageX: 50,
                    imageY: 50,
                    backgroundVideoPath: '',
                }}
            />
        </>
    );
};

registerRoot(RemotionRoot);
