import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import neo4j, { Driver } from 'neo4j-driver';

/**
 * Lazy Neo4j driver. Same defensive philosophy as the Qdrant client — booting
 * succeeds even if the Aura instance is dead, and only the
 * `query_exam_graph` tool returns a configuration error when invoked.
 */
@Injectable()
export class Neo4jClientProvider implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(Neo4jClientProvider.name);
  private _driver?: Driver;

  constructor(private readonly config: ConfigService) {}

  onModuleInit(): void {
    const uri = this.config.get<string>('NEO4J_URI');
    const username = this.config.get<string>('NEO4J_USERNAME');
    const password = this.config.get<string>('NEO4J_PASSWORD');
    if (!uri || !username || !password) {
      this.logger.warn(
        'NEO4J_URI / NEO4J_USERNAME / NEO4J_PASSWORD not all set — ' +
          'query_exam_graph will return a configuration error if invoked.',
      );
      return;
    }
    this._driver = neo4j.driver(uri, neo4j.auth.basic(username, password));
  }

  async onModuleDestroy(): Promise<void> {
    if (this._driver) {
      await this._driver.close().catch(() => undefined);
    }
  }

  require(): Driver {
    if (!this._driver) {
      throw new Error(
        'Neo4j is not configured (set NEO4J_URI / NEO4J_USERNAME / ' +
          'NEO4J_PASSWORD).',
      );
    }
    return this._driver;
  }
}
