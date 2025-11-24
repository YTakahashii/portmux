const passthrough = (msg: string): string => msg;

class MockChalk {
  red = passthrough;
  yellow = passthrough;
  green = passthrough;
  cyan = passthrough;
  gray = passthrough;

  constructor() {
    return this;
  }
}

export function createChalkMock(): { Chalk: typeof MockChalk; default: Record<string, unknown> } {
  const instance = new MockChalk();

  return {
    Chalk: MockChalk,
    default: {
      Chalk: MockChalk,
      ...instance,
    },
  };
}
