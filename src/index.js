import TMDB from "./providers/tmdb.js";
import SQLite from "./stores/sqlite.js";

(async function(){
	const TMDB_KEY = "***REMOVED***";
	const Provider = new TMDB(TMDB_KEY);

	const Store = new SQLite("db.db");
	await Store.open();

	const data = await Provider.getSerie(id);
	await Store.addSerie(data);
})();
