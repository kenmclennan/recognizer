export interface Citation {
  author: string;
  work: string;
  year: number;
  locator?: string;
}

export interface Principle {
  id: string;
  name: string;
  citation?: Citation;
}

const MARTIN = "Robert C. Martin";

export const PRINCIPLES: readonly Principle[] = [
  {
    id: "levelization",
    name: "Levelization",
    citation: {
      author: "John Lakos",
      work: "Large-Scale C++ Software Design",
      year: 1996,
    },
  },
  {
    id: "dependency-inversion-principle",
    name: "Dependency Inversion Principle",
    citation: {
      author: MARTIN,
      work: "The Dependency Inversion Principle, C++ Report",
      year: 1996,
    },
  },
  { id: "repository-policy", name: "Repository policy" },
  {
    id: "information-hiding",
    name: "Information hiding",
    citation: {
      author: "David Parnas",
      work: "On the Criteria To Be Used in Decomposing Systems into Modules",
      year: 1972,
    },
  },
  {
    id: "dead-code",
    name: "Dead code",
    citation: {
      author: MARTIN,
      work: "Clean Code",
      year: 2008,
      locator: "heuristic G9",
    },
  },
  {
    id: "small-functions",
    name: "Functions should be small",
    citation: {
      author: MARTIN,
      work: "Clean Code",
      year: 2008,
      locator: "chapter 3",
    },
  },
  {
    id: "dont-repeat-yourself",
    name: "Don't Repeat Yourself",
    citation: {
      author: "Andrew Hunt and David Thomas",
      work: "The Pragmatic Programmer",
      year: 1999,
    },
  },
];

export function principleName(id: string): string {
  return PRINCIPLES.find((entry) => entry.id === id)?.name ?? id;
}

export function principleOf(id: string): {
  principle: string;
  citation?: Citation;
} {
  const citation = PRINCIPLES.find((entry) => entry.id === id)?.citation;

  return citation === undefined
    ? { principle: id }
    : { principle: id, citation: { ...citation } };
}
