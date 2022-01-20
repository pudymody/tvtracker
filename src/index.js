import fastify from "fastify";
import fastify_static from "fastify-static";
import path from "path";
import pov from "point-of-view";
import njk from "nunjucks";
import SQLite from "./stores/sqlite.js";
import TMDB from "./providers/tmdb.js";

(async function(){
	const TMDB_KEY = "";
	const Provider = new TMDB(TMDB_KEY);
	const Store = new SQLite("db.db");
	await Store.open();

	// Require the framework and instantiate it
	const app = fastify({ logger: true })
	app.register(pov, {
		engine: {
			nunjucks: njk 
		},
		options : {
			onConfigure: (env) => {
				env.addFilter("pad", function(s){ return String(s).padStart(2, "0"); });
				env.addFilter("year", function(s){ return new Date(s).getFullYear(); });
				env.addFilter("date", function(s){
					const date = new Date(s);
					return date.toLocaleString('es-AR', {
						weekday: 'short', // long, short, narrow
						day: 'numeric', // numeric, 2-digit
						year: 'numeric', // numeric, 2-digit
						month: 'long', // numeric, 2-digit, long, short, narrow
						hour: 'numeric', // numeric, 2-digit
						minute: 'numeric', // numeric, 2-digit
						second: 'numeric', // numeric, 2-digit
					})
				});
			}
		}
	});
	app.register(fastify_static, {
		root: path.resolve('assets'),
		prefix: "/assets/"
	});

	// Declare a route
	app.get('/', async (request, reply) => {
		let finished = [];
		let unfinished = [];
		let movies = [];
		const seriesQuery = await Store.DB.each(
			`SELECT series.name, series.id, series.original_name, MAX(watches.watched) AS watched, COUNT(watches.watched) AS count_watches, COUNT(series.id) AS count_total FROM chapters
LEFT JOIN watches ON (watches.id = chapters.id)
INNER JOIN series ON (series.id = chapters.serie_id)
WHERE chapters.season_number > 0
GROUP BY series.id
ORDER BY watches.watched DESC`,
			(err, row) => {
				if (err) {
					throw err
				}

				row.href = `/tv/${row.id}`;
				row.poster_img = `/assets/series/${row.id}/poster.jpg`;
				if( row.count_watches != row.count_total ){
					unfinished.push(row);
				}else{
					finished.push(row);
				}
			}
		)
		const moviesQuery = await Store.DB.each(
			`SELECT * FROM movies ORDER BY watched DESC`,
			(err, row) => {
				if (err) {
					throw err
				}

				row.href = `/movie/${row.id}`;
				row.poster_img = `/assets/movies/${row.id}/poster.jpg`;
				movies.push(row);
			}
		)

		const history = finished.concat(movies).sort((a,b) => new Date(b.watched) - new Date(a.watched) );
		return reply.view('templates/index.njk', { unfinished, history })
	})

	app.get('/episode/watch/:id', async (request,reply) => {
		await Store.watchEpisode(request.params.id);
		const data = await Store.DB.get(`SELECT * FROM chapters WHERE id = ?`, request.params.id);

		reply.redirect(`/tv/${data.serie_id}`);
	});

	app.get('/episode/unwatch/:id', async (request,reply) => {
		await Store.unwatchEpisode(request.params.id);
		const data = await Store.DB.get(`SELECT * FROM chapters WHERE id = ?`, request.params.id);

		reply.redirect(`/tv/${data.serie_id}`);
	});

	app.get('/tv/:id/add', async (request,reply) => {
		const data = await Provider.getSerie(request.params.id);
		await Store.addSerie(data);
		reply.redirect(`/tv/${data.id}`);
	});

	app.get('/search', async (request,reply) => {
		const data = await Promise.all([Provider.searchSerie(request.query.q), Provider.searchMovie(request.query.q)]);
		return reply.view('templates/search.njk', { data, q: request.query.q })
	});

	app.get('/tv/:id', async (request, reply) => {
		let data = await Store.DB.get(`SELECT * FROM series WHERE id = ?`, request.params.id);
		if( data !== undefined ){
			data.poster_path = `/assets/series/${data.id}/poster.jpg`;
			data.backdrop_path = `/assets/series/${data.id}/backdrop.jpg`;
		}
		let chapters = {};
		const rowsCount = await Store.DB.each(
			`SELECT chapters.*, watches.watched FROM chapters
	LEFT JOIN watches ON (watches.id = chapters.id)
	WHERE serie_id = ?
	ORDER BY chapters.season_number DESC, chapters.episode_number ASC`,
			request.params.id,
			(err, row) => {
				if (err) {
					throw err
				}

				if( !chapters.hasOwnProperty(row.season_number) ){
					chapters[row.season_number] = [];
				}
				chapters[row.season_number].push(row);
			}
		)

		if( data === undefined ){
			data = await Provider.getSerie(request.params.id);
			data.isAdded = false;
			data.first_aired_date = data.first_air_date;

			data.seasons.map( s => s.episodes ).flat().forEach(function(row){
				if( !chapters.hasOwnProperty(row.season_number) ){
					chapters[row.season_number] = [];
				}
				row.watched = null;
				chapters[row.season_number].push(row);
			});
		}

		return reply.view('templates/serie.njk', { data,chapters: Object.entries(chapters).sort((a,b) => a[0] - b[0]) })
	})

	app.get('/movie/:id', async (request, reply) => {
		let data = await Store.DB.get(`SELECT * FROM movies WHERE id = ?`, request.params.id);
		if( data === undefined ){
			data = await Provider.getMovie(request.params.id);
			data.isAdded = false;
			data.watched = null;
		}else{
			data.poster_path = `/assets/movies/${data.id}/poster.jpg`;
			data.backdrop_path = `/assets/movies/${data.id}/backdrop.jpg`;
		}
		return reply.view('templates/movie.njk', { data })
	})

	app.get('/movie/:id/add', async (request,reply) => {
		const data = await Provider.getMovie(request.params.id);
		await Store.addMovie(data);
		reply.redirect(`/movie/${data.id}`);
	});

	// Run the server!
	const start = async () => {
		try {
			await app.listen(3000)
		} catch (err) {
			app.log.error(err)
			process.exit(1)
		}
	}
	start()
})();
