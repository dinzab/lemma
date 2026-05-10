import {
  BadRequestException,
  Controller,
  Get,
  NotFoundException,
  Query,
  UseGuards,
} from '@nestjs/common';

import { SupabaseAuthGuard } from '../auth';
import {
  InvalidLemmaUriError,
  LemmaUriNotFoundError,
  ReferencesService,
  type ResolvedReference,
} from './references.service';

/**
 * ReferencesController — read-only resolver for `lemma:` URIs.
 *
 *   GET /references/lemma?uri=<lemma_uri>
 *     → 200 { kind: 'figure'|'pair'|'exercise'|'exam', ... }
 *     → 400 if the URI grammar is invalid
 *     → 404 if no corpus entry resolves the URI
 *
 * Powers the inline citation chip's fallback path on the frontend:
 * when the conversation-scoped `<FigureRegistry>` is empty (or no
 * on-page surface matches a `lemma:exercise:…` chip), the chip hits
 * this endpoint and renders a thumbnail / opens a fallback Dialog
 * from the resolved metadata.
 *
 * Auth-gated by the same SupabaseAuthGuard the chat endpoints use,
 * so an anonymous client can't exfiltrate the corpus shape.
 */
@Controller('references')
@UseGuards(SupabaseAuthGuard)
export class ReferencesController {
  constructor(private readonly references: ReferencesService) {}

  @Get('lemma')
  async lemma(@Query('uri') uri?: string): Promise<ResolvedReference> {
    if (!uri || typeof uri !== 'string') {
      throw new BadRequestException('Query parameter "uri" is required.');
    }
    try {
      return await this.references.resolve(uri);
    } catch (err) {
      if (err instanceof InvalidLemmaUriError) {
        throw new BadRequestException(err.message);
      }
      if (err instanceof LemmaUriNotFoundError) {
        throw new NotFoundException(err.message);
      }
      throw err;
    }
  }
}
