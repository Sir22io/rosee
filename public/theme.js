// Thème appliqué avant le rendu pour éviter un flash (fichier séparé : la CSP interdit les scripts en ligne)
try { const t = localStorage.getItem('rosee-theme'); if (t === 'light' || t === 'dark') document.documentElement.dataset.theme = t; } catch (e) {}
