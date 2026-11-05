import { Module } from '@nestjs/common';
import { LearningAreasController } from './learning-areas.controller';
import { LearningAreasService } from './learning-areas.service';

@Module({ controllers: [LearningAreasController], providers: [LearningAreasService], exports: [LearningAreasService] })
export class LearningAreasModule {}
