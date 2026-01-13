// Background script для запросов к Rutracker (обход CORS)

browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'checkRutracker') {
    checkRutracker(message.title, message.year)
      .then(sendResponse)
      .catch(error => sendResponse({ error: error.message }));
    return true; // Указывает что ответ будет асинхронным
  }
});

async function checkRutracker(title, year) {
  // Формируем поисковый запрос
  const query = year ? `${title} ${year}` : title;
  const encodedQuery = encodeURIComponent(query);
  const searchUrl = `https://rutracker.me/forum/tracker.php?nm=${encodedQuery}`;

  try {
    const response = await fetch(searchUrl, {
      method: 'GET',
      credentials: 'include' // Включить cookies если пользователь залогинен
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const html = await response.text();
    const result = parseSearchResults(html);

    return {
      found: result.count > 0,
      count: result.count,
      searchUrl: searchUrl,
      needsAuth: result.needsAuth
    };
  } catch (error) {
    console.error('Rutracker check error:', error);
    return {
      found: false,
      count: 0,
      searchUrl: searchUrl,
      error: error.message
    };
  }
}

function parseSearchResults(html) {
  // Проверяем требуется ли авторизация (форма логина без таблицы результатов)
  const hasLoginForm = html.includes('login-form-full') || html.includes('id="login-form"');
  const hasSearchResults = html.includes('id="tor-tbl"') || html.includes('id="search-results"');

  if (hasLoginForm && !hasSearchResults) {
    return { count: 0, needsAuth: true };
  }

  let count = 0;

  // Метод 1: Проверяем сообщение об отсутствии результатов (ПРИОРИТЕТ)
  if (html.includes('Не найдено') ||
      html.includes('не найдено') ||
      html.includes('Ничего не найдено') ||
      html.includes('Результатов поиска: 0') ||
      html.includes('Торренты не найдены')) {
    return { count: 0, needsAuth: false };
  }

  // Метод 2: Ищем таблицу результатов и считаем строки
  // Rutracker использует класс "tCenter hl-tr" для строк результатов в таблице tor-tbl
  const rowMatches = html.match(/class="tCenter hl-tr"/g);
  if (rowMatches && rowMatches.length > 0) {
    count = rowMatches.length;
    return { count, needsAuth: false };
  }

  // Метод 3: Ищем ссылки на скачивание торрентов (dl-stub) - это точно раздачи
  const downloadLinks = html.match(/class="dl-stub"/g);
  if (downloadLinks && downloadLinks.length > 0) {
    count = downloadLinks.length;
    return { count, needsAuth: false };
  }

  // Метод 4: Ищем ссылки с классом t-title (названия торрентов)
  const titleLinks = html.match(/class="t-title[^"]*"/g);
  if (titleLinks && titleLinks.length > 0) {
    count = titleLinks.length;
    return { count, needsAuth: false };
  }

  // Метод 5: Проверяем наличие таблицы tor-tbl но без строк = 0 результатов
  if (html.includes('id="tor-tbl"')) {
    return { count: 0, needsAuth: false };
  }

  // Если нет таблицы результатов и нет формы логина - неизвестное состояние
  return { count: 0, needsAuth: false };
}
