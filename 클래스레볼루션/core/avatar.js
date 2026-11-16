export const AVATAR_COUNT = 70;

export function avatarNumber(value) {
  const id = Number(value);
  return Number.isInteger(id) && id >= 1 && id <= AVATAR_COUNT ? id : 1;
}

export function stillAvatar(value) {
  const index = avatarNumber(value) - 1;
  const frame = index % 10;
  const sheet = Math.floor(index / 10) + 1;
  return '<span class="avatar-still" aria-hidden="true" style="--avatar-image:url(assets/avatars/still/avatars-' +
    sheet + '.webp);--avatar-x:' + (frame % 5 * 25) + '%;--avatar-y:' + (Math.floor(frame / 5) * 100) + '%"></span>';
}

export function animatedAvatar(value) {
  const id = String(avatarNumber(value)).padStart(3, '0');
  return '<span class="avatar-fx" aria-hidden="true" style="--avatar-motion:url(assets/avatars/400/avatar_' +
    id + '_400.png)"></span>';
}
