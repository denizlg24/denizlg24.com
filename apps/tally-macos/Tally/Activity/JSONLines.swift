import Foundation

enum JSONLines {
    /// Calls `body` with every complete line after `offset` that contains any
    /// of `needles`, and returns the offset just past the last complete line.
    ///
    /// Session logs run to hundreds of megabytes of mostly tool output, so
    /// lines are matched as bytes and only the few that can matter are parsed.
    @discardableResult
    static func forEach(in data: Data, from offset: Int, containing needles: [String], _ body: (Data) -> Void) -> Int {
        let patterns = needles.map { Array($0.utf8) }
        return data.withUnsafeBytes { (buffer: UnsafeRawBufferPointer) -> Int in
            guard let base = buffer.baseAddress, offset < buffer.count else { return min(offset, buffer.count) }
            var start = offset
            while start < buffer.count {
                guard let newline = memchr(base + start, 0x0A, buffer.count - start) else { break }
                let end = base.distance(to: UnsafeRawPointer(newline))
                let length = end - start
                let matches = patterns.contains { pattern in
                    length >= pattern.count
                        && pattern.withUnsafeBytes { memmem(base + start, length, $0.baseAddress, pattern.count) } != nil
                }
                if matches {
                    body(Data(bytes: base + start, count: length))
                }
                start = end + 1
            }
            return start
        }
    }
}

struct ActivityFile: Sendable {
    let url: URL
    let size: Int
    let modified: Date
}

enum ActivityFiles {
    static func jsonl(under root: URL, modifiedAfter cutoff: Date) -> [ActivityFile] {
        let keys: [URLResourceKey] = [.fileSizeKey, .contentModificationDateKey, .isRegularFileKey]
        guard let enumerator = FileManager.default.enumerator(
            at: root, includingPropertiesForKeys: keys, options: [.skipsHiddenFiles]
        ) else { return [] }
        var files: [ActivityFile] = []
        for case let url as URL in enumerator where url.pathExtension == "jsonl" {
            guard let values = try? url.resourceValues(forKeys: Set(keys)),
                  values.isRegularFile == true,
                  let modified = values.contentModificationDate,
                  modified >= cutoff
            else { continue }
            files.append(ActivityFile(url: url, size: values.fileSize ?? 0, modified: modified))
        }
        return files
    }
}
