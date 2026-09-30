/** Robot asset reads stay on the resource server selected for this connection, including its port. */
export const isRobotResourceUrl = (baseUrl: string, target: string): boolean => {
  try {
    const base = new URL(baseUrl);
    const url = new URL(target);
    const directory = base.pathname.replace(/\/$/, '') + '/';
    return (
      ['http:', 'https:'].includes(base.protocol) &&
      !base.username &&
      !base.password &&
      !url.username &&
      !url.password &&
      url.origin === base.origin &&
      url.pathname.startsWith(directory) &&
      !/%(?:2f|5c)/i.test(url.pathname)
    );
  } catch {
    return false;
  }
};
