/**
 * DTO for thread response data
 * Used for API responses to ensure consistent structure
 */
export class ThreadResponseDto {
    id: string;
    title: string;
    createdAt: Date;
    updatedAt: Date;

    constructor(partial: Partial<ThreadResponseDto>) {
        Object.assign(this, partial);
    }

    /**
     * Creates a ThreadResponseDto from a database record
     */
    static fromRecord(record: {
        id: string;
        title: string;
        created_at: string | Date;
        updated_at: string | Date;
    }): ThreadResponseDto {
        return new ThreadResponseDto({
            id: record.id,
            title: record.title,
            createdAt: new Date(record.created_at),
            updatedAt: new Date(record.updated_at),
        });
    }
}

/**
 * DTO for paginated threads list response
 */
export class ThreadsListResponseDto {
    threads: ThreadResponseDto[];
    total: number;
    page: number;
    limit: number;

    constructor(
        threads: ThreadResponseDto[],
        total: number,
        page: number = 1,
        limit: number = 20,
    ) {
        this.threads = threads;
        this.total = total;
        this.page = page;
        this.limit = limit;
    }
}
