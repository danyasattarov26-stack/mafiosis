// Tasty Foods: five new foods and the recipes to make them.
export default function (api) {
  api.addItem({ key: 'pizza', en: 'Pizza', pt: 'Piza', kind: 'food', color: '#e8b04a', color2: '#c8302a', icon: 'pie', stack: 16, food: { hunger: 40, health: 4 } });
  api.addItem({ key: 'sushi', en: 'Sushi', pt: 'Sushi', kind: 'food', color: '#f2eee6', color2: '#2a4a2a', icon: 'fish', stack: 32, food: { hunger: 22, thirst: 4 } });
  api.addItem({ key: 'chocolate', en: 'Chocolate', pt: 'Chocolate', kind: 'food', color: '#5a3020', icon: 'ingot', stack: 32, food: { hunger: 10, health: 2 } });
  api.addItem({ key: 'cookie', en: 'Cookie', pt: 'Bolacha', kind: 'food', color: '#c8903e', icon: 'coin', stack: 64, food: { hunger: 6 } });
  api.addItem({ key: 'honey_toast', en: 'Honey Toast', pt: 'Torrada com Mel', kind: 'food', color: '#d8a040', icon: 'bread', stack: 16, food: { hunger: 26, health: 3, warm: 1 } });
  api.addRecipe('pizza', 1, { flour: 2, cooked_beef: 1, berries: 2 }, 'campfire');
  api.addRecipe('sushi', 2, { raw_fish: 1, wheat_item: 1, salt: 1 }, 'workbench');
  api.addRecipe('chocolate', 2, { berries: 3, honey: 1 }, 'campfire');
  api.addRecipe('cookie', 8, { flour: 2, chocolate: 1 }, 'campfire');
  api.addRecipe('honey_toast', 1, { bread: 1, honey: 1 }, 'campfire');
}
