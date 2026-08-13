import { getStateCourts } from './state-courts';

export interface LadderContext {
  fullName: string;
  type?: string;
  stateCodes: string[];
}

export interface LadderStep {
  id: string;
  applicable: (ctx: LadderContext) => boolean;
  buildQuery: (prevQuery: string, ctx: LadderContext) => string;
}

export function buildCourtClause(stateCodes: string[]): string {
  const allCourts = stateCodes.flatMap((code) => getStateCourts(code));
  if (allCourts.length === 0) {
    return '';
  }
  const formattedCourts = allCourts.map((c) => (c.includes(' ') ? `"${c}"` : c));
  return `court:(${formattedCourts.join(' OR ')})`;
}

export const PERSON_LADDER: LadderStep[] = [
  {
    id: 'party',
    applicable: (ctx) => Boolean(ctx.fullName && ctx.fullName.trim().length > 0),
    buildQuery: (_prev, ctx) => `party:(name:"${ctx.fullName.trim()}") AND is:docket`,
  },
  {
    id: 'state',
    applicable: (ctx) => ctx.stateCodes.length > 0,
    buildQuery: (prev, ctx) => {
      const courtClause = buildCourtClause(ctx.stateCodes);
      return courtClause ? `${prev} AND ${courtClause} AND is:state` : prev;
    },
  },
  {
    id: '10years',
    applicable: () => true,
    buildQuery: (prev) => `${prev} AND from:-10years`,
  },
];

export const COMPANY_LADDER: LadderStep[] = [
  {
    id: 'name',
    applicable: (ctx) => Boolean(ctx.fullName && ctx.fullName.trim().length > 0),
    buildQuery: (_prev, ctx) => `party:(name:"${ctx.fullName.trim()}") AND is:docket`,
  },
  {
    id: 'type',
    applicable: (ctx) => Boolean(ctx.type && ctx.type.trim().length > 0),
    buildQuery: (_prev, ctx) => {
      const name = ctx.fullName.trim();
      const type = ctx.type!.trim();
      return `party:(name:"${name} ${type}") AND is:docket`;
    },
  },
  {
    id: '10years',
    applicable: () => true,
    buildQuery: (prev) => `${prev} AND from:-10years`,
  },
];
