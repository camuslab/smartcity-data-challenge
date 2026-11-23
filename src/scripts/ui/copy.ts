const SUCCESS_VISIBLE_MS = 6_000;

async function writeClipboard(text: string): Promise<void> {
  if (!navigator.clipboard) throw new Error('이 브라우저는 복사 기능을 지원하지 않습니다.');
  await navigator.clipboard.writeText(text);
}

/** data-copy-target이 가리키는 요소의 글을 클립보드에 복사한다. */
export function initCopy(): void {
  document.querySelectorAll<HTMLButtonElement>('[data-copy-target]').forEach((button) => {
    const source = document.getElementById(button.dataset.copyTarget ?? '');
    const status = document.getElementById(button.dataset.copyStatus ?? '');
    if (!source || !status) return;
    let timer = 0;
    button.addEventListener('click', () => {
      window.clearTimeout(timer);
      writeClipboard(source.textContent ?? '')
        .then(() => {
          status.textContent = '양식을 복사했습니다. 메일 본문에 붙여 넣으세요.';
          timer = window.setTimeout(() => {
            status.textContent = '';
          }, SUCCESS_VISIBLE_MS);
        })
        .catch(() => {
          // 실패 안내는 다시 누를 때까지 남겨 둔다. 금방 사라지면 놓치기 쉽다.
          status.textContent = '복사하지 못했습니다. 양식을 직접 선택해 복사해 주세요.';
        });
    });
  });
}
