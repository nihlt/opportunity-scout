export const CALLBACK_TODAY = 'today';
export const CALLBACK_NEAREST = 'nearest';
export const CALLBACK_NEWEST = 'newest';

export function mainKeyboard() {
  return {
    inline_keyboard: [
      [
        { text: 'Today', callback_data: CALLBACK_TODAY },
        { text: 'Nearest 10', callback_data: CALLBACK_NEAREST },
        { text: 'Newest 10', callback_data: CALLBACK_NEWEST },
      ],
    ],
  };
}
