package dev.jagra.sample.data

import android.content.res.AssetManager
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONException
import org.json.JSONObject

private const val TIMEOUT_MS = 1500

/**
 * Items come from Mockoon when [serverUrl] answers, otherwise from the built-in `items.json` (SMP-2).
 * Both hold the same items, so flows give the same result either way.
 */
class ItemRepository(private val assets: AssetManager, private val serverUrl: String) {

    suspend fun load(): Pair<List<Item>, DataSource> = withContext(Dispatchers.IO) {
        val fromServer = fetchFromServer()
        if (fromServer != null) {
            fromServer to DataSource.MockServer
        } else {
            val text = assets.open("items.json").bufferedReader().use { it.readText() }
            parseItems(text) to DataSource.BuiltIn
        }
    }

    /** Returns false when the server refused the change. Built-in data has nothing to send to. */
    suspend fun save(item: Item, source: DataSource): Boolean = withContext(Dispatchers.IO) {
        if (source == DataSource.BuiltIn) return@withContext true
        try {
            val connection = open("/items/${item.id}", "PUT")
            try {
                connection.doOutput = true
                connection.setRequestProperty("Content-Type", "application/json")
                connection.outputStream.use { it.write(item.toJson().toString().toByteArray()) }
                connection.responseCode in 200..299
            } finally {
                connection.disconnect()
            }
        } catch (_: IOException) {
            false
        }
    }

    private fun fetchFromServer(): List<Item>? {
        if (serverUrl.isEmpty()) return null
        return try {
            val connection = open("/items", "GET")
            try {
                if (connection.responseCode != HttpURLConnection.HTTP_OK) return null
                parseItems(connection.inputStream.bufferedReader().use { it.readText() })
            } finally {
                connection.disconnect()
            }
        } catch (_: IOException) {
            null
        } catch (_: JSONException) {
            null
        }
    }

    private fun open(path: String, method: String): HttpURLConnection =
        (URL(serverUrl + path).openConnection() as HttpURLConnection).apply {
            requestMethod = method
            connectTimeout = TIMEOUT_MS
            readTimeout = TIMEOUT_MS
        }
}

private fun parseItems(text: String): List<Item> {
    val array = JSONArray(text)
    return List(array.length()) { index ->
        val json = array.getJSONObject(index)
        Item(
            id = json.getInt("id"),
            name = json.getString("name"),
            quantity = json.getInt("quantity"),
            description = json.optString("description"),
        )
    }
}

private fun Item.toJson(): JSONObject = JSONObject()
    .put("id", id)
    .put("name", name)
    .put("quantity", quantity)
    .put("description", description)
