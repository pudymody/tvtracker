import path from "path";
import got from "got";

import sqlite3 from 'sqlite3'
import { open } from 'sqlite'

import { promises as fs, createWriteStream } from "fs";
import {pipeline} from 'stream';
import {promisify} from 'util'
const streamPipeline = promisify(pipeline);

async function download(url,file){
	try {
		await streamPipeline(
			got.stream(url),
			createWriteStream(file)
		);
	}catch(e){
		console.error(`Failed to download ${url} to ${file}`);
		console.error(e);
	}
};

const ASSETS_FOLDER = "data/assets/";
export default class SQLite {
	constructor(db){
		this.DB_FILE = db;
	}

	async open(){
		this.DB = await open({
			filename: this.DB_FILE,
			driver: sqlite3.Database
		});

		await this.DB.exec(`
			BEGIN TRANSACTION;
			CREATE TABLE IF NOT EXISTS "seasons" (
				"id"	INTEGER NOT NULL UNIQUE,
				"name"	TEXT NOT NULL,
				"season_number"	INTEGER NOT NULL,
				"overview"	TEXT NOT NULL,
				"serie_id"	INTEGER NOT NULL,
				PRIMARY KEY("id"),
				FOREIGN KEY("serie_id") REFERENCES "series"("id") ON UPDATE CASCADE ON DELETE CASCADE
			);
			CREATE TABLE IF NOT EXISTS "chapters" (
				"id"	INTEGER NOT NULL UNIQUE,
				"episode_number"	INTEGER NOT NULL,
				"season_number"	INTEGER NOT NULL,
				"name"	TEXT NOT NULL,
				"overview"	TEXT NOT NULL,
				"air_date"	TEXT NOT NULL,
				"vote_average"	NUMERIC NOT NULL,
				"serie_id"	INTEGER NOT NULL,
				"season_id"	INTEGER NOT NULL,
				PRIMARY KEY("id"),
				FOREIGN KEY("serie_id") REFERENCES "series"("id") ON UPDATE CASCADE ON DELETE CASCADE,
				FOREIGN KEY("season_id") REFERENCES "seasons"("id") ON UPDATE CASCADE ON DELETE CASCADE
			);
			CREATE TABLE IF NOT EXISTS "series" (
				"id"	INTEGER NOT NULL UNIQUE,
				"name"	TEXT NOT NULL,
				"original_name"	TEXT NOT NULL,
				"first_aired_date"	TEXT NOT NULL,
				"lang"	TEXT NOT NULL,
				"overview"	TEXT NOT NULL,
				"status"	TEXT NOT NULL,
				"tagline"	TEXT NOT NULL,
				"vote"	NUMERIC,
				PRIMARY KEY("id")
			);
			CREATE TABLE IF NOT EXISTS "watches" (
				"id"	INTEGER NOT NULL,
				"watched"	TEXT NOT NULL,
				PRIMARY KEY("id"),
				FOREIGN KEY("id") REFERENCES "chapters"("id") ON UPDATE CASCADE ON DELETE CASCADE
			);
			CREATE TABLE IF NOT EXISTS "movies" (
				"id"	INTEGER NOT NULL,
				"imdb_id"	INTEGER UNIQUE,
				"title"	TEXT NOT NULL,
				"original_title"	TEXT NOT NULL,
				"overview"	TEXT NOT NULL,
				"release_date"	TEXT NOT NULL,
				"runtime"	INTEGER NOT NULL,
				"tagline"	TEXT NOT NULL,
				"vote"	NUMERIC NOT NULL,
				"watched"	TEXT,
				PRIMARY KEY("id")
			);
			COMMIT;
		`);
	}

	async addSerie(data){
		try {
			await fs.mkdir(`assets/series/${data.id}`);
		}catch(e){
			if( e.code != "EEXIST" ){
				throw e;
			}
		}

		let images = [];
		if( data.backdrop_path !== null ){
			const backdrop_file = path.join(ASSETS_FOLDER, "series", String(data.id), "backdrop.jpg");
			images.push(download( data.backdrop_path, backdrop_file));
		}
		if( data.poster_path !== null ){
			const poster_file = path.join(ASSETS_FOLDER, "series", String(data.id), "poster.jpg");
			images.push(download( data.poster_path, poster_file));
		}
		await Promise.all(images);

		await this.DB.run(
			"INSERT OR REPLACE INTO series VALUES (?,?,?,?,?,?,?,?,?)",
			data.id,data.name,data.original_name,data.first_air_date,data.original_language,data.overview,data.status,data.tagline,data.vote_average
		);

		const stmt_season = await this.DB.prepare("INSERT OR REPLACE INTO seasons VALUES (?,?,?,?,?)");
		const stmt_chapter = await this.DB.prepare("INSERT OR REPLACE INTO chapters VALUES (?,?,?,?,?,?,?,?,?)");

		for( let s of data.seasons ){
			if( s.poster_path !== null ){
				await download( s.poster_path, `assets/series/${data.id}/s${s.season_number}.jpg`);
			}
			await stmt_season.run(s.id, s.name, s.season_number, s.overview, data.id);
			for( let c of s.episodes ){
				await stmt_chapter.run(c.id,c.episode_number, c.season_number, c.name, c.overview, c.air_date, c.vote_average, data.id, s.id);
			}
		}

		await stmt_season.finalize();
		await stmt_chapter.finalize();

		return data;
	}

	async getSerie(id){
		let data = await this.DB.get(`SELECT * FROM series WHERE id = ?`, id);
		if( data === undefined ){
			return undefined;
		}

		data.poster_path = `assets/series/${data.id}/poster.jpg`;
		data.backdrop_path = `assets/series/${data.id}/backdrop.jpg`;
		let chapters = {};
		await this.DB.each(
			`SELECT chapters.*, watches.watched FROM chapters
	LEFT JOIN watches ON (watches.id = chapters.id)
	WHERE serie_id = ?
	ORDER BY chapters.season_number DESC, chapters.episode_number ASC`,
			id,
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

		data.chapters = chapters;
		return data;
	}

	watchEpisode(id){
		return this.DB.run(
			`INSERT INTO watches VALUES (?,strftime("%Y-%m-%dT%H:%M:%fZ", "now"))`,
			id
		);
	}

	unwatchEpisode(id){
		return this.DB.run(
			`DELETE FROM watches WHERE id = ?`,
			id
		);
	}

	getChapter(id){
		return this.DB.get(`SELECT * FROM chapters WHERE id = ?`, id);
	}

	async getLastSeries(){
		let series = [];
		await this.DB.each(
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

				row.href = `tv/${row.id}`;
				row.poster_img = `assets/series/${row.id}/poster.jpg`;
				if( row.count_watches != row.count_total ){
					row.finished = false;
				}else{
					row.finished = true;
				}

				series.push(row);
			}
		);

		return series;
	}

	async addMovie(data){
		try {
			await fs.mkdir(`assets/movies/${data.id}`);
		}catch(e){
			if( e.code != "EEXIST" ){
				throw e;
			}
		}

		let images = [];
		if( data.backdrop_path !== null ){
			const backdrop_file = path.join(ASSETS_FOLDER, "movies", String(data.id), "backdrop.jpg");
			images.push(download( data.backdrop_path, backdrop_file));
		}
		if( data.poster_path !== null ){
			const poster_file = path.join(ASSETS_FOLDER, "movies", String(data.id), "poster.jpg");
			images.push(download( data.poster_path, poster_file));
		}
		await Promise.all(images);

		await this.DB.run(
			`INSERT OR REPLACE INTO movies VALUES (?,?,?,?,?,?,?,?,?,strftime("%Y-%m-%dT%H:%M:%fZ", "now"))`,
			data.id,data.imdb_id,data.title,data.original_title,data.overview,data.release_date,data.runtime,data.tagline,data.vote_average
		);

		return data;
	}

	async getMovie(id){
		let data = await this.DB.get(`SELECT * FROM movies WHERE id = ?`, id);
		if( data !== undefined ){
			data.poster_path = `assets/movies/${data.id}/poster.jpg`;
			data.backdrop_path = `assets/movies/${data.id}/backdrop.jpg`;
		}

		return data;
	}

	async getLastMovies(){
		let movies = [];
		await this.DB.each(
			`SELECT * FROM movies ORDER BY watched DESC`,
			(err, row) => {
				if (err) {
					throw err
				}

				row.href = `movie/${row.id}`;
				row.poster_img = `assets/movies/${row.id}/poster.jpg`;
				movies.push(row);
			}
		);

		return movies;
	}
}
