const API = 'https://nutriplan-api.vercel.app/api';

const searchInput = document.querySelector('#search');
const areaSelect = document.querySelector('#area');
const areaChips = document.querySelector('#area-chips');
const categorySelect = document.querySelector('#category');
const categoryChips = document.querySelector('#category-chips');
const recipeGrid = document.querySelector('#recipe-grid');
const statusBox = document.querySelector('#status');
const countText = document.querySelector('#recipe-count');
const listView = document.querySelector('#list-view');
const detailView = document.querySelector('#detail-view');
const productsView = document.querySelector('#products-view');
const logView = document.querySelector('#log-view');
const productStatus = document.querySelector('#product-status');
const productResults = document.querySelector('#product-results');
const logDateInput = document.querySelector('#log-date');
const LOG_KEY = 'nutriplan-food-log-v1';
const GOALS_KEY = 'nutriplan-goals-v1';
const viewHashes = { recipes: '#recipes', products: '#products', log: '#foodlog' };
const nutrientNames = ['calories', 'protein', 'carbs', 'fat'];
const defaultGoals = { calories: 2000, protein: 50, carbs: 275, fat: 78 };

let meals = [];
let requestNumber = 0;
let searchTimer;
let productRequestNumber = 0;
let nutritionKey = 'DEMO_KEY';
let moreCategoriesOpen = false;

const categoryStyle = {
  Beef: ['red', '🥩'], Chicken: ['amber', '🍗'], Dessert: ['pink', '🎂'],
  Lamb: ['orange', '🍖'], Miscellaneous: ['slate', '🥣'], Pasta: ['yellow', '🍝'],
  Pork: ['red', '🥓'], Seafood: ['blue', '🐟'], Side: ['green', '🍲'],
  Starter: ['cyan', '🍴'], Vegan: ['green', '🌿'], Vegetarian: ['lime', '🌱'],
  Breakfast: ['yellow', '☀'], Goat: ['orange', '🐐']
};

// The cuisine list uses demonyms for these places, but meals use country names.
const areaAliases = {
  Argentine: 'Argentina', Dutch: 'Netherlands', French: 'France',
  Indian: 'India', Norwegian: 'Norway', Slovak: 'Slovakia',
  American: 'United States'
};

function addCuisineChip(name, label = name) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'cuisine-chip';
  button.dataset.area = name;
  button.textContent = label;
  button.addEventListener('click', () => {
    areaSelect.value = name;
    updateFilterUI();
    loadMeals();
  });
  areaChips.append(button);
}
let logEntries = readStoredArray(LOG_KEY);
let goals = readGoals();

function readStoredArray(key) {
  try {
    const value = JSON.parse(localStorage.getItem(key) || '[]');
    return Array.isArray(value) ? value : [];
  } catch (error) {
    return [];
  }
}

function readGoals() {
  try {
    const value = JSON.parse(localStorage.getItem(GOALS_KEY) || 'null');
    if (value && nutrientNames.every(name => Number(value[name]) > 0)) return value;
  } catch (error) { /* Use the editable defaults. */ }
  return { ...defaultGoals };
}

function localDate() {
  const date = new Date();
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function numberOrNull(value) {
  return value === null || value === undefined || value === '' || !Number.isFinite(Number(value))
    ? null : Number(value);
}

function nutritionValues(source) {
  return Object.fromEntries(nutrientNames.map(name => [name, numberOrNull(source?.[name])]));
}

function formatValue(value, unit = '') {
  return value === null ? '—' : `${Math.round(value * 10) / 10}${unit}`;
}

function showView(view) {
  listView.hidden = view !== 'recipes';
  detailView.hidden = true;
  productsView.hidden = view !== 'products';
  logView.hidden = view !== 'log';
  const titles = {
    recipes: ['Meals & Recipes', 'Discover delicious recipes for your next meal'],
    products: ['Product Scanner', 'Find packaged foods and review their nutrition'],
    log: ['Food Log', 'Track your meals and daily nutrition']
  };
  document.querySelector('#page-title').textContent = titles[view][0];
  document.querySelector('#page-subtitle').textContent = titles[view][1];
  for (const button of document.querySelectorAll('[data-view]')) {
    const active = button.dataset.view === view;
    button.classList.toggle('active', active);
    if (active) button.setAttribute('aria-current', 'page');
    else button.removeAttribute('aria-current');
  }
  if (view === 'log') renderFoodLog();
  window.scrollTo(0, 0);
}

function viewFromHash() {
  if (location.hash === viewHashes.products) return 'products';
  if (location.hash === viewHashes.log) return 'log';
  return 'recipes';
}

function navigateTo(view) {
  if (location.hash !== viewHashes[view]) location.hash = viewHashes[view];
  showView(view);
}

async function getJson(path) {
  const response = await fetch(`${API}${path}`);
  if (!response.ok) throw new Error(`Request failed (${response.status})`);
  const data = await response.json();
  if (!data || !Array.isArray(data.results)) throw new Error('Unexpected API response');
  return data.results;
}

async function getMeal(id) {
  const response = await fetch(`${API}/meals/${encodeURIComponent(id)}`);
  if (!response.ok) throw new Error(`Request failed (${response.status})`);
  const data = await response.json();
  if (!data || !data.result || data.result.id !== id) throw new Error('Unexpected API response');
  return data.result;
}

function showStatus(message, isError = false) {
  recipeGrid.hidden = true;
  statusBox.hidden = false;
  statusBox.className = isError ? 'status error' : 'status';
  statusBox.textContent = message;
  if (isError) {
    const retry = document.createElement('button');
    retry.type = 'button';
    retry.textContent = 'Try again';
    retry.addEventListener('click', loadMeals);
    statusBox.append(retry);
  }
}

function makeOption(value) {
  const option = document.createElement('option');
  option.value = value;
  option.textContent = value;
  return option;
}

async function loadFilters() {
  addCuisineChip('', 'All Cuisines');
  updateFilterUI();
  const [categoryRequest, areaRequest] = await Promise.allSettled([
    getJson('/meals/categories'),
    getJson('/meals/areas')
  ]);
  if (categoryRequest.status === 'fulfilled') {
    const categories = categoryRequest.value;
    for (const [index, category] of categories.entries()) {
      if (!category.name) continue;
      categorySelect.append(makeOption(category.name));
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'category-chip';
      button.dataset.category = category.name;
      button.dataset.tone = (categoryStyle[category.name] || ['green'])[0];
      if (index >= 12) {
        button.classList.add('extra-category');
        button.hidden = true;
      }
      const icon = document.createElement('span');
      icon.className = 'chip-icon';
      icon.setAttribute('aria-hidden', 'true');
      const glyph = document.createElement('span');
      glyph.className = 'chip-glyph';
      glyph.textContent = (categoryStyle[category.name] || ['green', '✦'])[1];
      icon.append(glyph);
      const label = document.createElement('span');
      label.textContent = category.name;
      button.append(icon, label);
      button.addEventListener('click', () => {
        categorySelect.value = category.name;
        updateFilterUI();
        loadMeals();
        document.querySelector('#recipes-title').scrollIntoView({ behavior: 'smooth' });
      });
      categoryChips.append(button);
    }
    document.querySelector('#more-categories').hidden = categories.length <= 12;
  } else {
    categoryChips.textContent = 'Meal types are temporarily unavailable. Refresh to try again.';
    categoryChips.className = 'filter-error';
  }
  if (areaRequest.status === 'fulfilled') {
    const areas = areaRequest.value;
    for (const name of [...new Set(areas.map(area => area.name).filter(Boolean))]) {
      const area = areaAliases[name] || name;
      const option = makeOption(area);
      option.textContent = name;
      areaSelect.append(option);
      addCuisineChip(area, name);
    }
  } else {
    const message = document.createElement('span');
    message.className = 'filter-error';
    message.textContent = 'Cuisines are temporarily unavailable. Refresh to try again.';
    areaChips.append(message);
  }
}

function updateFilterUI() {
  document.querySelector('#clear-filters').hidden = !(
    searchInput.value || areaSelect.value || categorySelect.value
  );
  for (const chip of categoryChips.querySelectorAll('button')) {
    chip.classList.toggle('selected', chip.dataset.category === categorySelect.value);
  }
  for (const chip of areaChips.querySelectorAll('button')) {
    const selected = chip.dataset.area === areaSelect.value;
    chip.classList.toggle('selected', selected);
    chip.setAttribute('aria-pressed', String(selected));
  }
}

function uniqueMeals(items) {
  return [...new Map(items.filter(meal => meal && meal.id).map(meal => [meal.id, meal])).values()];
}

async function loadMeals() {
  const currentRequest = ++requestNumber;
  const query = searchInput.value.trim();
  const category = categorySelect.value;
  const area = areaSelect.value;
  countText.textContent = 'Loading recipes...';
  showStatus('Loading recipes...');
  updateFilterUI();

  try {
    let results;
    if (query) {
      results = await getJson(`/meals/search?q=${encodeURIComponent(query)}`);
      results = results.filter(meal =>
        (!category || meal.category === category) && (!area || meal.area === area)
      );
    } else if (category || area) {
      // The API applies one filter at a time, so combine selections in the browser.
      const params = new URLSearchParams({ limit: area && category ? '100' : '25' });
      if (area) params.set('area', area);
      else params.set('category', category);
      results = await getJson(`/meals/filter?${params}`);
      results = results.filter(meal =>
        (!category || meal.category === category) && (!area || meal.area === area)
      ).slice(0, 25);
    } else {
      results = uniqueMeals(await getJson('/meals/random?count=30'));
      if (results.length < 25) {
        results = uniqueMeals([...results, ...await getJson('/meals/random?count=25')]);
      }
      results = results.slice(0, 25);
    }
    if (currentRequest !== requestNumber) return;
    meals = uniqueMeals(results);
    renderMeals();
  } catch (error) {
    if (currentRequest !== requestNumber) return;
    countText.textContent = 'Recipes unavailable';
    showStatus(`Could not load recipes. ${error.message}`, true);
  }
}

function renderMeals() {
  countText.textContent = `Showing ${meals.length} ${meals.length === 1 ? 'recipe' : 'recipes'}`;
  recipeGrid.replaceChildren();
  if (!meals.length) {
    showStatus('No recipes found. Try another search or clear the filters.');
    return;
  }
  for (const meal of meals) {
    const card = document.createElement('button');
    card.type = 'button';
    card.className = 'recipe-card';
    card.setAttribute('aria-label', `View ${meal.name} recipe`);
    const imageWrap = document.createElement('div');
    imageWrap.className = 'card-image';
    const image = document.createElement('img');
    image.src = meal.thumbnail || '';
    image.alt = meal.name || 'Recipe';
    image.loading = 'lazy';
    const badges = document.createElement('div');
    badges.className = 'badges';
    for (const value of [meal.category, meal.area]) {
      if (!value) continue;
      const badge = document.createElement('span');
      badge.className = 'badge';
      badge.textContent = value;
      badges.append(badge);
    }
    imageWrap.append(image, badges);
    const body = document.createElement('div');
    body.className = 'card-body';
    const title = document.createElement('h3');
    title.textContent = meal.name || 'Untitled recipe';
    const description = document.createElement('p');
    description.textContent = meal.instructions?.[0] || 'Open this recipe for details.';
    const meta = document.createElement('div');
    meta.className = 'card-meta';
    const categoryText = document.createElement('span');
    categoryText.textContent = meal.category || 'Uncategorized';
    const areaText = document.createElement('span');
    areaText.textContent = meal.area || 'Cuisine unknown';
    meta.append(categoryText, areaText);
    body.append(title, description, meta);
    card.append(imageWrap, body);
    card.addEventListener('click', () => openMeal(meal.id));
    recipeGrid.append(card);
  }
  statusBox.hidden = true;
  recipeGrid.hidden = false;
}

async function openMeal(id) {
  listView.hidden = true;
  detailView.hidden = false;
  detailView.textContent = 'Loading recipe...';
  window.scrollTo(0, 0);
  try {
    const meal = await getMeal(id);
    renderDetail(meal);
  } catch (error) {
    detailView.replaceChildren(makeBackButton());
    const message = document.createElement('p');
    message.textContent = `Could not load this recipe. ${error.message}`;
    detailView.append(message);
  }
}

function makeBackButton() {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'back-button';
  button.textContent = '← Back to recipes';
  button.addEventListener('click', () => showView('recipes'));
  return button;
}

function renderDetail(meal) {
  detailView.replaceChildren(makeBackButton());
  const card = document.createElement('article');
  card.className = 'detail-card';
  const image = document.createElement('img');
  image.className = 'detail-hero';
  image.src = meal.thumbnail || '';
  image.alt = meal.name || 'Recipe';
  const content = document.createElement('div');
  content.className = 'detail-content';
  const title = document.createElement('h2');
  title.textContent = meal.name;
  const meta = document.createElement('p');
  meta.className = 'detail-meta';
  meta.textContent = [meal.category, meal.area].filter(Boolean).join(' · ');
  const columns = document.createElement('div');
  columns.className = 'detail-columns';
  const ingredients = document.createElement('section');
  const ingredientTitle = document.createElement('h3');
  ingredientTitle.textContent = 'Ingredients';
  const ingredientList = document.createElement('ul');
  for (const item of meal.ingredients || []) {
    const li = document.createElement('li');
    li.textContent = [item.measure, item.ingredient].filter(Boolean).join(' ');
    ingredientList.append(li);
  }
  ingredients.append(ingredientTitle, ingredientList);
  const instructions = document.createElement('section');
  const instructionTitle = document.createElement('h3');
  instructionTitle.textContent = 'Instructions';
  const instructionList = document.createElement('ol');
  for (const step of meal.instructions || []) {
    const li = document.createElement('li');
    li.textContent = step;
    instructionList.append(li);
  }
  instructions.append(instructionTitle, instructionList);
  columns.append(ingredients, instructions);
  content.append(title, meta, columns);
  const nutritionBox = document.createElement('section');
  nutritionBox.className = 'nutrition-box';
  const nutritionTitle = document.createElement('h3');
  nutritionTitle.textContent = 'Nutrition per serving';
  const nutritionStatus = document.createElement('div');
  nutritionStatus.className = 'muted';
  nutritionStatus.textContent = 'Analyzing ingredients with the nutrition API...';
  nutritionBox.append(nutritionTitle, nutritionStatus);
  content.append(nutritionBox);
  const actions = document.createElement('div');
  actions.className = 'detail-actions';
  const logButton = document.createElement('button');
  logButton.type = 'button';
  logButton.className = 'primary-button';
  logButton.textContent = 'Log This Meal';
  logButton.disabled = true;
  let mealNutrition = nutritionValues(null);
  logButton.addEventListener('click', () => {
    const saved = addLogEntry({
      type: 'meal', sourceId: meal.id, name: meal.name,
      image: meal.thumbnail || '', amount: '1 serving', nutrition: mealNutrition
    });
    if (saved) {
      logDateInput.value = localDate();
      navigateTo('log');
    } else {
      nutritionStatus.textContent = 'Could not save this meal. Check browser storage settings.';
    }
  });
  actions.append(logButton);
  if (meal.youtube) {
    const videoId = youtubeId(meal.youtube);
    if (videoId) {
      const videoSection = document.createElement('section');
      videoSection.className = 'recipe-video';
      const videoTitle = document.createElement('h3');
      videoTitle.textContent = 'Recipe video';
      const player = document.createElement('iframe');
      player.src = `https://www.youtube-nocookie.com/embed/${videoId}`;
      player.title = `${meal.name} video`;
      player.loading = 'lazy';
      player.allow = 'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share';
      player.allowFullscreen = true;
      videoSection.append(videoTitle, player);
      content.append(videoSection);
    }
    const video = document.createElement('a');
    video.href = meal.youtube;
    video.target = '_blank';
    video.rel = 'noopener noreferrer';
    video.textContent = 'Watch recipe video ↗';
    actions.append(video);
  }
  content.append(actions);
  const note = document.createElement('p');
  note.className = 'detail-note';
  note.textContent = 'Recipe nutrition is an API estimate. USDA ingredient matches may be imperfect. Review the ingredient matches before relying on the numbers.';
  content.append(note);
  card.append(image, content);
  detailView.append(card);

  async function analyze(key = nutritionKey) {
    nutritionStatus.textContent = 'Analyzing ingredients with the nutrition API...';
    logButton.disabled = true;
    try {
      const response = await fetch(`${API}/nutrition/analyze`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': key },
        body: JSON.stringify({
          recipeName: meal.name,
          ingredients: (meal.ingredients || []).map(item =>
            [item.measure, item.ingredient].filter(Boolean).join(' ')
          ).filter(Boolean)
        })
      });
      const result = await response.json();
      if (!response.ok || !result.success || !result.data?.perServing) {
        throw new Error(result.error?.message || result.error || `Request failed (${response.status})`);
      }
      mealNutrition = nutritionValues(result.data.perServing);
      nutritionStatus.replaceChildren();
      const servingText = document.createElement('p');
      servingText.className = 'muted';
      servingText.textContent = `Estimated for 1 of ${result.data.servings} API servings`;
      nutritionStatus.append(servingText, makeNutrientGrid(mealNutrition));
      const matches = document.createElement('details');
      const summary = document.createElement('summary');
      summary.textContent = 'Review USDA ingredient matches';
      matches.append(summary);
      const list = document.createElement('ul');
      for (const item of result.data.ingredients || []) {
        const li = document.createElement('li');
        li.textContent = `${item.original || 'Ingredient'} → ${item.matched?.description || 'No match'}`;
        list.append(li);
      }
      matches.append(list);
      nutritionStatus.append(matches);
      logButton.disabled = false;
    } catch (error) {
      nutritionStatus.replaceChildren();
      const message = document.createElement('p');
      message.textContent = String(error.message).includes('429')
        ? 'Nutrition service rate limit reached. Enter your USDA API key to retry.'
        : `Nutrition unavailable: ${error.message}`;
      nutritionStatus.append(message);
      const keyRow = document.createElement('div');
      keyRow.className = 'key-row';
      const keyInput = document.createElement('input');
      keyInput.className = 'key-input';
      keyInput.type = 'password';
      keyInput.placeholder = 'Optional USDA API key';
      keyInput.setAttribute('aria-label', 'Optional USDA API key');
      const retry = document.createElement('button');
      retry.type = 'button';
      retry.className = 'primary-button';
      retry.textContent = 'Retry analysis';
      retry.addEventListener('click', () => {
        nutritionKey = keyInput.value.trim() || nutritionKey;
        analyze(nutritionKey);
      });
      keyRow.append(keyInput, retry);
      nutritionStatus.append(keyRow);
      const explanation = document.createElement('p');
      explanation.className = 'muted';
      explanation.textContent = 'You can still log the meal; its unknown nutrients will be excluded from totals.';
      nutritionStatus.append(explanation);
      logButton.disabled = false;
    }
  }

  if (meal.ingredients?.length) analyze();
  else {
    nutritionStatus.textContent = 'Nutrition unavailable: this recipe has no ingredient list.';
    logButton.disabled = false;
  }
}

function youtubeId(link) {
  try {
    const url = new URL(link);
    let id = '';
    if (url.hostname === 'youtu.be' || url.hostname === 'www.youtu.be') id = url.pathname.slice(1);
    else if (url.hostname === 'youtube.com' || url.hostname === 'www.youtube.com') {
      id = url.searchParams.get('v') || (url.pathname.startsWith('/embed/') ? url.pathname.slice(7) : '');
    }
    return /^[A-Za-z0-9_-]{11}$/.test(id) ? id : null;
  } catch (error) {
    return null;
  }
}

function makeNutrientGrid(values) {
  const grid = document.createElement('div');
  grid.className = 'product-nutrients';
  for (const [name, label, unit] of [
    ['calories', 'Calories', ' kcal'], ['protein', 'Protein', ' g'],
    ['carbs', 'Carbs', ' g'], ['fat', 'Fat', ' g']
  ]) {
    const item = document.createElement('span');
    item.textContent = `${label}: ${formatValue(values[name], unit)}`;
    grid.append(item);
  }
  return grid;
}

function addLogEntry(item) {
  const entry = {
    id: (globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`),
    date: localDate(), ...item
  };
  logEntries.push(entry);
  try {
    localStorage.setItem(LOG_KEY, JSON.stringify(logEntries));
    return true;
  } catch (error) {
    logEntries.pop();
    return false;
  }
}

function renderFoodLog() {
  const selectedDate = logDateInput.value || localDate();
  const todayEntries = logEntries.filter(entry => entry.date === selectedDate);
  const totals = Object.fromEntries(nutrientNames.map(name => [name, 0]));
  const unknownCounts = Object.fromEntries(nutrientNames.map(name => [name, 0]));
  for (const entry of todayEntries) {
    for (const name of nutrientNames) {
      const value = numberOrNull(entry.nutrition?.[name]);
      if (value === null) unknownCounts[name] += 1;
      else totals[name] += value;
    }
  }
  const progress = document.querySelector('#nutrition-progress');
  progress.replaceChildren();
  for (const [name, label, unit] of [
    ['calories', 'Calories', 'kcal'], ['protein', 'Protein', 'g'],
    ['carbs', 'Carbs', 'g'], ['fat', 'Fat', 'g']
  ]) {
    const box = document.createElement('div');
    box.className = 'progress-item';
    const heading = document.createElement('span');
    heading.textContent = label;
    const amount = document.createElement('strong');
    amount.textContent = `${formatValue(totals[name])} ${unit}`;
    const goal = document.createElement('span');
    goal.textContent = `of ${goals[name]} ${unit} goal`;
    const track = document.createElement('div');
    track.className = 'progress-track';
    track.setAttribute('role', 'progressbar');
    track.setAttribute('aria-label', `${label} progress`);
    track.setAttribute('aria-valuemin', '0');
    track.setAttribute('aria-valuemax', String(goals[name]));
    track.setAttribute('aria-valuenow', String(Math.min(goals[name], Math.round(totals[name]))));
    const fill = document.createElement('div');
    fill.className = 'progress-fill';
    fill.style.width = `${Math.min(100, (totals[name] / goals[name]) * 100)}%`;
    track.append(fill);
    box.append(heading, amount, goal, track);
    if (unknownCounts[name]) {
      const unknown = document.createElement('span');
      unknown.textContent = `${unknownCounts[name]} item(s) missing ${label.toLowerCase()} data`;
      box.append(unknown);
    }
    progress.append(box);
  }
  document.querySelector('#log-count').textContent = `${todayEntries.length} item${todayEntries.length === 1 ? '' : 's'}`;
  const list = document.querySelector('#log-items');
  list.replaceChildren();
  if (!todayEntries.length) {
    const empty = document.createElement('p');
    empty.className = 'muted';
    empty.textContent = 'No food logged for this day.';
    list.append(empty);
  }
  for (const entry of todayEntries.slice().reverse()) {
    const row = document.createElement('div');
    row.className = 'log-item';
    if (entry.image) {
      const image = document.createElement('img');
      image.src = entry.image;
      image.alt = '';
      image.loading = 'lazy';
      row.append(image);
    }
    const info = document.createElement('div');
    info.className = 'log-item-info';
    const name = document.createElement('strong');
    name.textContent = entry.name;
    const detail = document.createElement('span');
    detail.textContent = `${entry.type === 'product' ? 'Product' : 'Recipe'} · ${entry.amount} · ${formatValue(numberOrNull(entry.nutrition?.calories), ' kcal')}`;
    const macros = document.createElement('span');
    macros.textContent = `Protein ${formatValue(numberOrNull(entry.nutrition?.protein), ' g')} · Carbs ${formatValue(numberOrNull(entry.nutrition?.carbs), ' g')} · Fat ${formatValue(numberOrNull(entry.nutrition?.fat), ' g')}`;
    info.append(name, detail, document.createElement('br'), macros);
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'remove-button';
    remove.textContent = 'Remove';
    remove.setAttribute('aria-label', `Remove ${entry.name}`);
    remove.addEventListener('click', () => {
      const previous = logEntries;
      logEntries = logEntries.filter(item => item.id !== entry.id);
      try {
        localStorage.setItem(LOG_KEY, JSON.stringify(logEntries));
        renderFoodLog();
      } catch (error) {
        logEntries = previous;
        remove.textContent = 'Storage error';
      }
    });
    row.append(info, remove);
    list.append(row);
  }
}

function setProductStatus(message, isError = false) {
  productResults.hidden = true;
  productStatus.hidden = false;
  productStatus.textContent = message;
  productStatus.className = isError ? 'status error' : 'status';
}

async function fetchProduct(path, single = false) {
  const response = await fetch(`${API}${path}`);
  const data = await response.json();
  if (!response.ok) throw new Error(data.error?.message || data.error || `Request failed (${response.status})`);
  if (single) {
    if (!data.result) throw new Error('Product not found');
    return [data.result];
  }
  if (!Array.isArray(data.results)) throw new Error('Unexpected API response');
  return data.results;
}

async function searchProducts(path, single = false) {
  const request = ++productRequestNumber;
  setProductStatus('Loading products...');
  try {
    const products = await fetchProduct(path, single);
    if (request !== productRequestNumber) return;
    renderProducts(products);
  } catch (error) {
    if (request !== productRequestNumber) return;
    setProductStatus(`Could not load products. ${error.message}`, true);
  }
}

function renderProducts(products) {
  productResults.replaceChildren();
  if (!products.length) {
    setProductStatus('No products found. Try another name or barcode.');
    return;
  }
  for (const product of products) {
    const card = document.createElement('article');
    card.className = 'product-card';
    if (product.image) {
      const image = document.createElement('img');
      image.src = product.image;
      image.alt = product.name || 'Product';
      image.loading = 'lazy';
      card.append(image);
    }
    const title = document.createElement('h3');
    title.textContent = product.name || 'Unnamed product';
    const brand = document.createElement('p');
    brand.className = 'muted';
    brand.textContent = [product.brand, product.barcode && `Barcode ${product.barcode}`].filter(Boolean).join(' · ');
    const nutrientTitle = document.createElement('strong');
    nutrientTitle.textContent = 'Nutrition per 100 g';
    const values = nutritionValues(product.nutrients);
    const addForm = document.createElement('form');
    addForm.className = 'product-add';
    const quantityLabel = document.createElement('label');
    quantityLabel.textContent = 'Amount (g)';
    const quantity = document.createElement('input');
    quantity.className = 'quantity-input';
    quantity.type = 'number';
    quantity.min = '1';
    quantity.step = '1';
    quantity.value = '100';
    quantity.required = true;
    quantityLabel.append(quantity);
    const addButton = document.createElement('button');
    addButton.type = 'submit';
    addButton.className = 'primary-button';
    addButton.textContent = 'Add to Food Log';
    addForm.append(quantityLabel, addButton);
    const feedback = document.createElement('p');
    feedback.className = 'feedback';
    addForm.addEventListener('submit', event => {
      event.preventDefault();
      const grams = Number(quantity.value);
      if (!Number.isFinite(grams) || grams <= 0) return;
      const scaled = Object.fromEntries(nutrientNames.map(name => [
        name, values[name] === null ? null : values[name] * grams / 100
      ]));
      const saved = addLogEntry({
        type: 'product', sourceId: product.barcode || '',
        name: product.name || 'Unnamed product', image: product.image || '',
        amount: `${grams} g`, nutrition: scaled
      });
      feedback.textContent = saved ? 'Added to today’s Food Log.' : 'Could not save. Check browser storage settings.';
      feedback.classList.toggle('error', !saved);
    });
    card.append(title, brand, nutrientTitle, makeNutrientGrid(values), addForm, feedback);
    productResults.append(card);
  }
  productStatus.hidden = true;
  productResults.hidden = false;
}

searchInput.addEventListener('input', () => {
  clearTimeout(searchTimer);
  requestNumber += 1; // Ignore an older API response while the new search is debouncing.
  searchTimer = setTimeout(loadMeals, 350);
  updateFilterUI();
});
areaSelect.addEventListener('change', loadMeals);
categorySelect.addEventListener('change', loadMeals);
document.querySelector('#clear-filters').addEventListener('click', () => {
  clearTimeout(searchTimer);
  searchInput.value = '';
  areaSelect.value = '';
  categorySelect.value = '';
  loadMeals();
});
document.querySelector('#view-all').addEventListener('click', () => {
  clearTimeout(searchTimer);
  searchInput.value = '';
  areaSelect.value = '';
  categorySelect.value = '';
  loadMeals();
  document.querySelector('#recipes-title').scrollIntoView({ behavior: 'smooth' });
});
document.querySelector('#more-categories').addEventListener('click', event => {
  moreCategoriesOpen = !moreCategoriesOpen;
  for (const chip of categoryChips.querySelectorAll('.extra-category')) {
    chip.hidden = !moreCategoriesOpen;
  }
  event.currentTarget.textContent = moreCategoriesOpen ? 'Show fewer meal types' : 'More meal types';
});
for (const [buttonId, isList] of [['#grid-button', false], ['#list-button', true]]) {
  document.querySelector(buttonId).addEventListener('click', () => {
    recipeGrid.classList.toggle('list', isList);
    document.querySelector('#grid-button').setAttribute('aria-pressed', String(!isList));
    document.querySelector('#list-button').setAttribute('aria-pressed', String(isList));
  });
}

for (const button of document.querySelectorAll('[data-view]')) {
  button.addEventListener('click', () => navigateTo(button.dataset.view));
}
window.addEventListener('hashchange', () => showView(viewFromHash()));

document.querySelector('#product-search-form').addEventListener('submit', event => {
  event.preventDefault();
  const query = document.querySelector('#product-search').value.trim();
  if (query) searchProducts(`/products/search?q=${encodeURIComponent(query)}`);
});

document.querySelector('#barcode-form').addEventListener('submit', event => {
  event.preventDefault();
  const barcode = document.querySelector('#barcode').value.trim();
  if (/^[0-9]+$/.test(barcode)) {
    searchProducts(`/products/barcode/${encodeURIComponent(barcode)}`, true);
  }
});

logDateInput.value = localDate();
logDateInput.addEventListener('change', renderFoodLog);
const goalForm = document.querySelector('#goal-form');
for (const name of nutrientNames) goalForm.elements.namedItem(name).value = goals[name];
goalForm.addEventListener('submit', event => {
  event.preventDefault();
  const updated = Object.fromEntries(nutrientNames.map(name => [
    name, Number(goalForm.elements.namedItem(name).value)
  ]));
  if (!nutrientNames.every(name => Number.isFinite(updated[name]) && updated[name] > 0)) return;
  const message = document.querySelector('#goal-message');
  try {
    localStorage.setItem(GOALS_KEY, JSON.stringify(updated));
    goals = updated;
    message.textContent = 'Goals saved.';
    message.classList.remove('error');
    renderFoodLog();
  } catch (error) {
    message.textContent = 'Could not save goals. Check browser storage settings.';
    message.classList.add('error');
  }
});

showView(viewFromHash());
loadFilters();
loadMeals();
