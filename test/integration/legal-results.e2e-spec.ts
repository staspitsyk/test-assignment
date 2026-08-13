import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import * as request from 'supertest';
import { MockAgent } from 'undici';
import * as fs from 'fs';
import * as path from 'path';
import { AppModule } from 'src/app.module';
import { UNDICI_DISPATCHER } from 'src/docket-alarm/docket-alarm.http';

describe('Legal Results API E2E (POST /api/v1/legal_results)', () => {
  let app: INestApplication;
  let mockAgent: MockAgent;
  let mockPool: ReturnType<MockAgent['get']>;

  const fixturesDir = path.join(__dirname, '../fixtures/entities');

  beforeAll(async () => {
    mockAgent = new MockAgent();
    mockAgent.disableNetConnect();
    mockPool = mockAgent.get('https://www.docketalarm.com');

    mockPool
      .intercept({ path: '/api/v1.1/login/', method: 'POST' })
      .reply(200, { success: true, login_token: 'e2e-valid-token' })
      .persist();

    mockPool
      .intercept({
        path: (p: string) => p.includes('/api/v1.1/search/'),
        method: 'GET',
      })
      .reply(200, {
        count: 2,
        search_results: [
          {
            court: 'Florida State Court',
            docket: 'FL-2024-001',
            title: 'Bradley Friedman v. Insurance Co',
            link: 'https://www.docketalarm.com/cases/FL-1',
            date_filed: '2024-05-10',
          },
          {
            court: 'U.S. District Court, Southern District of Florida',
            docket: '1:24-cv-99999',
            title: 'Sample Litigation Matter',
            link: 'https://www.docketalarm.com/cases/US-1',
            date_filed: '2024-01-15',
          },
        ],
      })
      .persist();

    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(UNDICI_DISPATCHER)
      .useValue(mockAgent)
      .compile();

    app = moduleRef.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: false,
        transform: true,
      }),
    );
    await app.init();
  });

  afterAll(async () => {
    if (mockAgent) {
      mockAgent.close();
    }
    if (app) {
      await app.close();
    }
  });

  describe('5 Golden Entity Fixtures', () => {
    const fixtureFiles = [
      'bradley-friedman.json',
      'gilbert.json',
      'westlake.json',
      'goldman-sachs.json',
      'christopher-brien.json',
    ];

    for (const file of fixtureFiles) {
      it(`should successfully process fixture ${file}`, async () => {
        const filePath = path.join(fixturesDir, file);
        const fixtureData = JSON.parse(fs.readFileSync(filePath, 'utf-8'));

        const response = await request(app.getHttpServer())
          .post('/api/v1/legal_results')
          .set('x-request-id', `e2e-test-${file}`)
          .send(fixtureData)
          .expect(200);

        expect(response.body).toHaveProperty('results');
        expect(response.body).toHaveProperty('meta');
        expect(Array.isArray(response.body.results)).toBe(true);

        const meta = response.body.meta;
        expect(meta.entityId).toBe(fixtureData.entityId);
        expect(meta.entityType).toBe(fixtureData.entityType);
        expect(meta.requestId).toBe(`e2e-test-${file}`);
        expect(typeof meta.elapsedMs).toBe('number');
        expect(['hit', 'miss', 'stale', 'bypass']).toContain(meta.cache);
      });
    }
  });

  describe('Caching & Bypass behavior', () => {
    it('should return cache hit on subsequent identical request', async () => {
      const filePath = path.join(fixturesDir, 'westlake.json');
      const fixtureData = JSON.parse(fs.readFileSync(filePath, 'utf-8'));

      // First call -> cache miss
      const res1 = await request(app.getHttpServer())
        .post('/api/v1/legal_results')
        .send(fixtureData)
        .expect(200);

      // Second call -> cache hit
      const res2 = await request(app.getHttpServer())
        .post('/api/v1/legal_results')
        .send(fixtureData)
        .expect(200);

      expect(res2.body.meta.cache).toBe('hit');
      expect(res2.body.results).toEqual(res1.body.results);
    });

    it('should respect x-cache-bypass header in test environment', async () => {
      const filePath = path.join(fixturesDir, 'bradley-friedman.json');
      const fixtureData = JSON.parse(fs.readFileSync(filePath, 'utf-8'));

      const response = await request(app.getHttpServer())
        .post('/api/v1/legal_results')
        .set('x-cache-bypass', 'true')
        .send(fixtureData)
        .expect(200);

      expect(response.body.meta.cache).toBe('bypass');
    });
  });

  describe('Input Validation Error Paths (422 invalid_entity)', () => {
    it('should return 422 invalid_entity for single-token Person name', async () => {
      const invalidPerson = {
        entityId: 999,
        entityType: 'Person',
        entityDetails: {
          name: [{ full: 'Cher', confidence: 0.9 }],
        },
      };

      const res = await request(app.getHttpServer())
        .post('/api/v1/legal_results')
        .send(invalidPerson)
        .expect(422);

      expect(res.body).toHaveProperty('error');
      expect(res.body.error.code).toBe('invalid_entity');
    });

    it('should return 422 invalid_entity when candidates are below threshold', async () => {
      const lowConf = {
        entityId: 998,
        entityType: 'Company',
        entityDetails: {
          name: [{ full: 'Low Confidence Inc', confidence: 0.1 }],
        },
      };

      const res = await request(app.getHttpServer())
        .post('/api/v1/legal_results')
        .send(lowConf)
        .expect(422);

      expect(res.body).toHaveProperty('error');
      expect(res.body.error.code).toBe('invalid_entity');
    });
  });
});
