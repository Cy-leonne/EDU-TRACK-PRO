import { Module } from '@nestjs/common';
import { FilesModule } from '../files/files.module';
import { AssessmentsController } from './assessments.controller';
import { AssessmentsService } from './assessments.service';
import { ResultsController } from './results.controller';
import { ResultsService } from './results.service';

@Module({
  imports: [FilesModule],
  controllers: [AssessmentsController, ResultsController],
  providers: [AssessmentsService, ResultsService],
  exports: [AssessmentsService, ResultsService],
})
export class AssessmentsModule {}
