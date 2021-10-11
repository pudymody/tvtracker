import fastify from "fastify";
import fastify_static from "fastify-static";
import path from "path";
import pov from "point-of-view";
import njk from "nunjucks";
import SQLite from "./stores/sqlite.js";

(async function(){
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
		const rowsCount = await Store.DB.each(
			`SELECT series.name, series.id, series.original_name, MAX(watches.watched) AS last_watched, COUNT(watches.watched) AS count_watches, COUNT(series.id) AS count_total FROM chapters
LEFT JOIN watches ON (watches.id = chapters.id)
INNER JOIN series ON (series.id = chapters.serie_id)
WHERE chapters.season_number > 0
GROUP BY series.id
ORDER BY watches.watched DESC`,
			(err, row) => {
				if (err) {
					throw err
				}

				if( row.count_watches != row.count_total ){
					unfinished.push(row);
				}else{
					finished.push(row);
				}
			}
		)
		reply.view('templates/index.njk', { unfinished, finished })
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
		const data = await Store.addSerie(request.params.id);
		reply.redirect(`/tv/${data.id}`);
	});

	app.get('/tv/:id', async (request, reply) => {
		const data = await Store.DB.get(`SELECT * FROM series WHERE id = ?`, request.params.id);
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
		reply.view('templates/serie.njk', { data,chapters: Object.entries(chapters).sort((a,b) => a[0] - b[0]) })
	})

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
