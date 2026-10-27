export interface ReleaseFacts {
  tag: string;
  packageVersion: string;
  tagOnMain: boolean;
}

export type ReleaseVerdict = { ok: true } | { ok: false; error: string };

const VERSION_TAG = /^v\d+\.\d+\.\d+$/;

export function checkRelease({ tag, packageVersion, tagOnMain }: ReleaseFacts): ReleaseVerdict {
  if (!VERSION_TAG.test(tag)) {
    return { ok: false, error: `Tag ${tag} is not a vX.Y.Z version tag.` };
  }
  if (tag !== `v${packageVersion}`) {
    return {
      ok: false,
      error: `Tag ${tag} does not match package.json version ${packageVersion}. Bump package.json or retag.`,
    };
  }
  if (!tagOnMain) {
    return {
      ok: false,
      error: `Tag ${tag} points at a commit that is not on main. Push main first, or push both with git push --atomic.`,
    };
  }
  return { ok: true };
}
